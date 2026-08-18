import path from 'path'
import { loadJournalEntries } from './electron/services/excel.service'

async function main() {
  const filePath = path.join(__dirname, '../2025青色申告.xlsx')
  const entries = await loadJournalEntries(filePath)
  
  console.log(`全仕訳件数: ${entries.length} 件`)

  const selectedSubAccount = 'Amazonカード'
  const selectedSettleSheet = '住信SBI銀行'
  const rawKeyword = '口座振替　ミツイスミトモカード'
  const normKeyword = rawKeyword.replace(/\s+/g, '')

  const rawSettleEntries = entries.filter(e => e.sourceSheet === selectedSettleSheet)
  console.log(`住信SBI銀行の明細件数: ${rawSettleEntries.length} 件`)

  const selectedRightItems = rawSettleEntries.filter(e => {
    const isAlreadySet = (e.debitAccount === '未払金' || e.creditAccount === '未払金') &&
                         (e.debitSubAccount === selectedSubAccount || e.creditSubAccount === selectedSubAccount)
    const normDesc = (e.description || '').replace(/\s+/g, '')
    const hasKeyword = normDesc.includes(normKeyword)

    if (hasKeyword) {
      console.log(`[候補] Date=${e.date?.toISOString().split('T')[0]}, desc="${e.description}", debitAcc="${e.debitAccount}", debitSub="${e.debitSubAccount}", note="${e.note}" => isAlreadySet=${isAlreadySet}`)
    }

    return !isAlreadySet && hasKeyword
  })

  console.log(`\n抽出件数: ${selectedRightItems.length} 件`)
  selectedRightItems.forEach(item => {
    console.log(` -> Date: ${item.date?.toISOString().split('T')[0]} | Desc: ${item.description} | Amt: ¥${item.amount}`)
  })
}

main().catch(console.error)
