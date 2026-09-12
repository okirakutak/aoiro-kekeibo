import { useState, useEffect, useCallback } from 'react'

interface ReconciliationPanelProps {
  entries: any[];
  ledgers?: any[];
  accounts?: any[];
  targets?: any[];
  onReload: () => Promise<void>;
}

// 日付フォーマットヘルパー (MM/DD 形式: 月/日)
const formatDate = (dateVal: any): string => {
  if (!dateVal) return ''
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return String(dateVal)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 日付をYMD文字列に正規化するヘルパー（時刻を無視）
const dateToYmd = (dateVal: any): string => {
  if (!dateVal) return ''
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 全角・半角・大文字・小文字・記号の違いを吸収するテキスト正規化ヘルパー
const normalizeText = (str: string): string => {
  if (!str) return ''
  return str
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[\.\-＿_\s　]/g, '')
}

// 突合済みかどうかを判定するヘルパー（備考に「#NNNN」4桁数字が含まれるか）
const isReconciled = (note: string | undefined): boolean => {
  if (!note) return false
  return /#\d{4}/.test(note)
}

// 突合Noの抽出ヘルパー
const getReconcileNo = (note: string | undefined): string | null => {
  if (!note) return null
  const match = note.match(/#(\d{4})/)
  return match ? match[1] : null
}

// クレジットカードの請求月・支払日を計算するヘルパー関数
export const calculatePaymentDate = (
  dateVal: any,
  cutoffDay: number | 'last' | undefined,
  paymentMonthOffset: number | undefined,
  paymentDay: number | 'last' | undefined
): { billingMonthStr: string; paymentDate: Date } | null => {
  if (!dateVal || cutoffDay === undefined || paymentMonthOffset === undefined || paymentDay === undefined) return null
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return null

  const year = d.getFullYear()
  const month = d.getMonth() // 0-11
  const day = d.getDate()

  // 1. 締め月の判定
  let billingYear = year
  let billingMonth = month // 0-11
  
  if (cutoffDay !== 'last') {
    if (day > (cutoffDay as number)) {
      // 締日を過ぎている場合は翌月扱い（翌月締め）
      billingMonth += 1
      if (billingMonth > 11) {
        billingMonth = 0
        billingYear += 1
      }
    }
  }

  // 2. 支払年月の計算
  let payYear = billingYear
  let payMonth = billingMonth + paymentMonthOffset
  while (payMonth > 11) {
    payMonth -= 12
    payYear += 1
  }

  // 3. 支払日の決定
  let payDateObj: Date
  if (paymentDay === 'last') {
    payDateObj = new Date(payYear, payMonth + 1, 0)
  } else {
    payDateObj = new Date(payYear, payMonth, paymentDay as number)
    if (payDateObj.getMonth() !== payMonth) {
      // 月を跨いだ場合(例: 2月30日)は月末に補正
      payDateObj = new Date(payYear, payMonth + 1, 0)
    }
  }

  return {
    billingMonthStr: `${billingYear}年${billingMonth + 1}月締分`,
    paymentDate: payDateObj
  }
}


export default function ReconciliationPanel({ entries, ledgers = [], accounts: _accounts = [], targets = [], onReload }: ReconciliationPanelProps) {
  const [configs, setConfigs] = useState<any[]>([])

  // 左上：選択された科目キー（親: "未払金", 子: "未払金::Amazon"）
  const [selectedLedgerKey, setSelectedLedgerKey] = useState<string>('')
  
  // 右上：選択された決済先シート名（例: "Amazonカード"）
  const [selectedSettleSheet, setSelectedSettleSheet] = useState<string>('')

  // 突合済み非表示フラグ（デフォルト: ON）
  const [hideReconciled, setHideReconciled] = useState<boolean>(true)

  // 自動突合の実行状態
  const [isReconciling, setIsReconciling] = useState<boolean>(false)
  const [reconcileResult, setReconcileResult] = useState<string>('')

  // 手動突合用の選択状態
  const [selectedLeftIds, setSelectedLeftIds] = useState<Set<string>>(new Set())
  const [selectedRightIds, setSelectedRightIds] = useState<Set<string>>(new Set())

  // 期末実残高調整用の状態
  const [actualBalanceInput, setActualBalanceInput] = useState<string>('')
  const [offsetAccountType, setOffsetAccountType] = useState<'支払手数料' | '事業主借'>('支払手数料')
  const [isAdjusting, setIsAdjusting] = useState<boolean>(false)

  // インポート設定（設定シートの各行設定）の取得
  useEffect(() => {
    const loadTargets = async () => {
      // @ts-ignore
      const res = await window.electronAPI.getImportTargets()
      if (res && res.success) {
        setConfigs(res.data || [])
      }
    }
    loadTargets()
  }, [])

  // 科目が期末残高チェックの対象（未払金/未払費用、売掛金/未収入金、買掛金、預り金、仮払金/仮受金）かどうかを判定
  const isTargetAccount = (accountName: string): boolean => {
    return /未払金|未払費用|売掛金|未収入金|買掛金|預り金|仮払金|仮受金/.test(accountName)
  }

  // 1. 左上：期末残高が発生している（closingBalance !== 0）対象科目および補助科目の抽出
  const activeLedgers = ledgers.filter(l => {
    if (!isTargetAccount(l.accountName)) return false
    return l.closingBalance !== 0
  })

  // 初期ロード時の選択科目自動セット
  useEffect(() => {
    if (activeLedgers.length > 0 && !selectedLedgerKey) {
      const firstKey = activeLedgers[0].subAccountName
        ? `${activeLedgers[0].accountName}::${activeLedgers[0].subAccountName}`
        : activeLedgers[0].accountName
      setSelectedLedgerKey(firstKey)
    }
  }, [activeLedgers, selectedLedgerKey])

  // 左上で選択されている科目・補助科目の取得
  const isSubAccount = selectedLedgerKey.includes('::')
  const [selectedAccount, selectedSubAccount] = isSubAccount 
    ? selectedLedgerKey.split('::') 
    : [selectedLedgerKey, undefined]

  const currentLedger = ledgers.find(l => {
    if (isSubAccount) {
      return l.accountName === selectedAccount && l.subAccountName === selectedSubAccount
    }
    return l.accountName === selectedAccount && !l.subAccountName
  })

  // 科目が負債（未払金、買掛金等）か資産（売掛金等）かを判定
  const isLiability = /未払金|未払費用|買掛金|預り金|仮受金/.test(selectedAccount)

  // 2. 左下：選択された科目の「発生側」明細のみ取得
  let leftEntriesAll: any[] = []
  if (selectedLedgerKey) {
    if (isSubAccount && selectedSubAccount) {
      // 補助科目指定時: Excelの該当補助科目用シート（例: AliExpressシート）の発生明細のみ厳密抽出
      leftEntriesAll = entries.filter(e => {
        // ソースシートが該当補助科目名（例: "AliExpress"）と一致
        if (e.sourceSheet === selectedSubAccount) return true
        
        // または、貸方補助科目（負債）/ 借方補助科目（資産）が該当補助科目と厳密一致
        if (isLiability) {
          return e.creditSubAccount === selectedSubAccount
        } else {
          return e.debitSubAccount === selectedSubAccount
        }
      })
    } else if (selectedAccount) {
      // 勘定科目全体（親）指定時: 発生側（負債=貸方、資産=借方）の明細のみ表示
      leftEntriesAll = entries.filter(e => {
        return isLiability ? e.creditAccount === selectedAccount : e.debitAccount === selectedAccount
      })
    }
  }

  // 3. 右上・右下：決済先シート選択＆キーワード検索該当明細の抽出
  // 設定シート (`configs`) から該当補助科目の設定情報を検索
  const currentShopTarget = configs.find(c => 
    c.sheetName === selectedSubAccount || 
    c.subAccount === selectedSubAccount || 
    c.jsonConfig?.targetSheet === selectedSubAccount
  )

  // 選択可能な全ワークシート（決済先シートの選択肢）
  const allSheets = configs.map(c => c.sheetName)

  // 左上の選択科目が変わったときの右上決済先シートの自動切替
  useEffect(() => {
    if (isSubAccount && selectedSubAccount) {
      // 1. 設定シート4列目に指定されている決済先シート（例: 住信SBI銀行、Amazonカード等）を優先セット
      const targetSettle = currentShopTarget?.settleSheet
      if (targetSettle) {
        setSelectedSettleSheet(targetSettle)
      } else {
        // 2. なければ全シートの中から一致・または最初のシートをセット
        const matched = allSheets.find(s => s.toLowerCase().includes('カード') || s.toLowerCase().includes('銀行')) || allSheets[0] || ''
        setSelectedSettleSheet(matched)
      }
    } else {
      // その他の科目（親科目など）の場合は無記入とする
      setSelectedSettleSheet('')
    }
  }, [selectedLedgerKey, configs, currentShopTarget])

  // 検索キーワードの構築（設定シート5列目、6列目、JSON設定、補助科目名から多角的に構築）
  const searchKeywords: string[] = []
  if (selectedSubAccount) searchKeywords.push(selectedSubAccount)
  if (currentShopTarget?.settleSub) searchKeywords.push(currentShopTarget.settleSub)
  if (currentShopTarget?.keyword) searchKeywords.push(currentShopTarget.keyword)
  if (currentShopTarget?.searchKeywords) {
    searchKeywords.push(...currentShopTarget.searchKeywords)
  }
  if (currentShopTarget?.jsonConfig?.shoppingMatchKeywords) {
    searchKeywords.push(...currentShopTarget.jsonConfig.shoppingMatchKeywords)
  }
  if (selectedSubAccount?.includes('メルカリ')) {
    searchKeywords.push('メルカリ', 'メルペイ', 'merpay')
  }

  // 右下：決済先シートの全明細の中から、キーワードに合致するもののみ抽出（正規化比較）
  let rightEntriesAll: any[] = []
  if (selectedSettleSheet) {
    const rawSettleEntries = entries.filter(e => e.sourceSheet === selectedSettleSheet)
    if (searchKeywords.length > 0) {
      const normKeywords = searchKeywords.map(normalizeText).filter(Boolean)
      rightEntriesAll = rawSettleEntries.filter(e => {
        const normDesc = normalizeText(String(e.description || ''))
        return normKeywords.some(kw => normDesc.includes(kw))
      })
    } else {
      rightEntriesAll = rawSettleEntries
    }
  }

  // ============================================================
  // 自動突合ロジック
  // ============================================================

  const runAutoReconciliation = useCallback(async () => {
    if (!selectedSubAccount || !selectedSettleSheet) return
    if (isReconciling) return

    // 未突合の発生側明細を抽出
    // ※ 発生側は sourceSheet が補助科目名と一致するもののみ（＝発生側シートの明細のみ）
    const unreconciledLeft = leftEntriesAll.filter(e =>
      !isReconciled(e.note) && e.sourceSheet === selectedSubAccount
    )
    // 未突合の決済側明細を抽出
    // ※ 決済側は「相手科目が未払金かつ補助科目が選択中の補助科目」の明細のみに限定
    //    （キーワード検索で広くヒットした無関係な明細を除外）
    const unreconciledRight = rightEntriesAll.filter(e => {
      if (isReconciled(e.note)) return false
      // 決済側の仕訳で debitAccount=未払金, debitSubAccount=補助科目名 のもののみ
      if (e.debitAccount === selectedAccount && e.debitSubAccount === selectedSubAccount) return true
      // または勘定科目列に直接設定されているもの（Excel上でacct=未払金, sub=Amazon）
      if (e.creditAccount === selectedAccount && e.creditSubAccount === selectedSubAccount) return true
      return false
    })

    if (unreconciledLeft.length === 0 || unreconciledRight.length === 0) return

    // 発生側・決済側を日付(YMD)でグルーピング
    const leftByDate = new Map<string, any[]>()
    for (const e of unreconciledLeft) {
      const ymd = dateToYmd(e.date)
      if (!ymd) continue
      if (!leftByDate.has(ymd)) leftByDate.set(ymd, [])
      leftByDate.get(ymd)!.push(e)
    }

    const rightByDate = new Map<string, any[]>()
    for (const e of unreconciledRight) {
      const ymd = dateToYmd(e.date)
      if (!ymd) continue
      if (!rightByDate.has(ymd)) rightByDate.set(ymd, [])
      rightByDate.get(ymd)!.push(e)
    }

    // 既存の突合Noの最大値を取得して次の番号を決定
    let maxNo = -1
    for (const e of entries) {
      const no = getReconcileNo(e.note)
      if (no !== null) {
        const num = parseInt(no, 10)
        if (num > maxNo) maxNo = num
      }
    }
    let nextNo = maxNo + 1

    // 突合アイテムのリストを構築
    const reconciliationItems: any[] = []
    const usedRightIds = new Set<string>() // 突合済みの決済側明細IDを保持

    for (const [ymd, leftGroup] of leftByDate.entries()) {
      const leftDate = new Date(ymd)

      let i = 0
      while (i < leftGroup.length) {
        let matched = false
        let currentSum = 0
        const currentLeftItems: any[] = []

        // 先頭から順に明細を加算して検索
        for (let j = i; j < leftGroup.length; j++) {
          currentSum += leftGroup[j].amount || 0
          currentLeftItems.push(leftGroup[j])

          // 0日後から5日後まで順番に探索
          for (let offset = 0; offset <= 5; offset++) {
            const targetDate = new Date(leftDate)
            targetDate.setDate(targetDate.getDate() + offset)
            const targetYmd = dateToYmd(targetDate)

            const rawRightGroup = rightByDate.get(targetYmd)
            if (!rawRightGroup || rawRightGroup.length === 0) continue

            // 未使用の決済側明細のみを抽出
            const rightGroup = rawRightGroup.filter((r: any) => !usedRightIds.has(r.id))
            if (rightGroup.length === 0) continue

            // 決済側の中から、合計額(currentSum)と一致する1件を探す
            const matchingRight = rightGroup.find((r: any) => r.amount === currentSum)

            if (matchingRight) {
              // マッチ成功！
              const noStr = String(nextNo).padStart(4, '0')

              if (currentLeftItems.length === 1) {
                // 1対1 の突合
                const leftEntry = currentLeftItems[0]
                reconciliationItems.push({
                  reconcileNo: noStr,
                  sourceSheetName: leftEntry.sourceSheet,
                  sourceDate: new Date(leftEntry.date).toISOString(),
                  sourceAmount: leftEntry.amount,
                  sourceDescription: leftEntry.description,
                  settleSheetName: matchingRight.sourceSheet,
                  settleDate: new Date(matchingRight.date).toISOString(),
                  settleAmount: matchingRight.amount,
                  settleDescription: matchingRight.description,
                  creditAccount: selectedAccount,
                  creditSubAccount: selectedSubAccount
                })
              } else {
                // N対1 の突合
                for (const leftEntry of currentLeftItems) {
                  reconciliationItems.push({
                    reconcileNo: noStr,
                    sourceSheetName: leftEntry.sourceSheet,
                    sourceDate: new Date(leftEntry.date).toISOString(),
                    sourceAmount: leftEntry.amount,
                    sourceDescription: leftEntry.description,
                    settleSheetName: '', // 決済側は下で個別に処理
                    settleDate: '',
                    settleAmount: 0,
                    settleDescription: '',
                    creditAccount: selectedAccount,
                    creditSubAccount: selectedSubAccount
                  })
                }
                // 決済側は1件だけなので
                reconciliationItems.push({
                  reconcileNo: noStr,
                  sourceSheetName: '', // 発生側は上で個別に処理済み
                  sourceDate: '',
                  sourceAmount: 0,
                  sourceDescription: '',
                  settleSheetName: matchingRight.sourceSheet,
                  settleDate: new Date(matchingRight.date).toISOString(),
                  settleAmount: matchingRight.amount,
                  settleDescription: matchingRight.description,
                  creditAccount: selectedAccount,
                  creditSubAccount: selectedSubAccount
                })
              }

              usedRightIds.add(matchingRight.id)
              nextNo++
              matched = true
              i = j // jまで処理済みとする
              break // offsetのループを抜ける
            }
          }
          if (matched) break // jのループを抜ける
        }
        i++ // matchedがtrueならj+1に、falseならi+1に進む
      }
    }

    if (reconciliationItems.length === 0) return

    // バックエンドに突合結果を送信してExcelに書き込む
    setIsReconciling(true)
    setReconcileResult('')
    try {
      // @ts-ignore
      const res = await window.electronAPI.applyReconciliation(reconciliationItems)
      if (res && res.success) {
        // 突合完了後、データを再読込して最新状態を反映
        await onReload()
        const matchCount = new Set(reconciliationItems.map(i => i.reconcileNo)).size
        setReconcileResult(`✅ ${matchCount} 件の突合を実行しました`)
      } else {
        setReconcileResult(`❌ エラー: ${res?.error || '不明なエラー'}`)
      }
    } catch (err: any) {
      setReconcileResult(`❌ エラー: ${err.message}`)
    } finally {
      setIsReconciling(false)
    }
  }, [leftEntriesAll, rightEntriesAll, selectedAccount, selectedSubAccount, selectedSettleSheet, entries, isReconciling, onReload])

  // クレジットカードかどうかの判定を「対象科目のシート（targets）に締日(cutoffDay)が設定されているか」で行う
  const isCreditCardCheckMode = (() => {
    if (!selectedSubAccount || targets.length === 0) return false
    // 対象科目名（補助科目名）と一致する設定シートの情報を探す
    const targetInfo = targets.find(t => t.sheetName === selectedSubAccount || t.subAccount === selectedSubAccount)
    if (!targetInfo) return false
    
    // 締日(cutoffDay)が空欄ではない場合、クレジットカードとみなす
    // (targetInfo.jsonConfig?.cutoffDay が設定されているかどうか)
    const hasCutoffDay = targetInfo.jsonConfig?.cutoffDay !== undefined && targetInfo.jsonConfig?.cutoffDay !== null
    return hasCutoffDay
  })()

  // 科目・決済先が変わったときに自動突合を実行
  useEffect(() => {
    if (!isCreditCardCheckMode && selectedSubAccount && selectedSettleSheet && leftEntriesAll.length > 0 && rightEntriesAll.length > 0) {
      // 未突合の明細が存在する場合のみ実行
      const hasUnreconciled = leftEntriesAll.some(e => !isReconciled(e.note)) &&
                               rightEntriesAll.some(e => !isReconciled(e.note))
      if (hasUnreconciled) {
        runAutoReconciliation()
      }
    }
  }, [selectedLedgerKey, selectedSettleSheet])

  // ============================================================
  // 手動突合ロジック
  // ============================================================
  
  const handleManualReconciliation = async () => {
    if (selectedLeftIds.size === 0 || selectedRightIds.size === 0) {
      alert('発生側と決済側の明細をそれぞれ1件以上選択してください。')
      return
    }

    const selectedLeftItems = leftEntriesAll.filter(e => selectedLeftIds.has(e.id))
    const selectedRightItems = rightEntriesAll.filter(e => selectedRightIds.has(e.id))

    const leftTotal = selectedLeftItems.reduce((sum, e) => sum + (e.amount || 0), 0)
    const rightTotal = selectedRightItems.reduce((sum, e) => sum + (e.amount || 0), 0)

    let finalLeftItems = [...selectedLeftItems]
    
    // 差額の計算とユーザー確認
    if (leftTotal > rightTotal) {
      const diff = leftTotal - rightTotal
      const confirmMessage = `発生側の合計(${leftTotal}円)が決済側の合計(${rightTotal}円)より ${diff}円 大きいです。\nクーポンやポイント割引などの可能性があります。\n\n発生側の金額から ${diff}円 を差し引いて突合しますか？`
      if (!window.confirm(confirmMessage)) return

      // 差額の差し引き（事業主貸優先）
      let remainingDiff = diff
      finalLeftItems = finalLeftItems.map(item => {
        // 事業主貸か、あるいは借方/貸方のどちらかが事業主貸か判定
        const isOwnerDraw = item.debitAccount === '事業主貸' || item.creditAccount === '事業主貸' || item.accountName === '事業主貸'
        if (remainingDiff > 0 && isOwnerDraw && item.amount >= remainingDiff) {
          const newItem = { ...item, newSourceAmount: item.amount - remainingDiff }
          remainingDiff = 0
          return newItem
        }
        return item
      })

      // 事業主貸だけでは引けなかった場合、最初のアイテムから引く（または他の事業主貸から引く）など簡易的な対応
      if (remainingDiff > 0) {
        for (let i = 0; i < finalLeftItems.length; i++) {
          if (remainingDiff === 0) break
          const item = finalLeftItems[i]
          if (item.amount > 0) {
            const deduction = Math.min(item.amount, remainingDiff)
            finalLeftItems[i] = { ...item, newSourceAmount: (item.newSourceAmount || item.amount) - deduction }
            remainingDiff -= deduction
          }
        }
      }
    } else if (leftTotal < rightTotal) {
      const diff = rightTotal - leftTotal
      const confirmMessage = `発生側の合計(${leftTotal}円)が決済側の合計(${rightTotal}円)より ${diff}円 小さいです。\n送料などの可能性があります。\n\n発生側の金額に ${diff}円 を加算して突合しますか？`
      if (!window.confirm(confirmMessage)) return

      // 差額の加算（事業主貸以外を優先）
      let added = false
      finalLeftItems = finalLeftItems.map(item => {
        const isOwnerDraw = item.debitAccount === '事業主貸' || item.creditAccount === '事業主貸' || item.accountName === '事業主貸'
        if (!added && !isOwnerDraw) {
          added = true
          return { ...item, newSourceAmount: item.amount + diff }
        }
        return item
      })
      
      // 事業主貸以外のアイテムがなかった場合、最初のアイテムに加算する
      if (!added && finalLeftItems.length > 0) {
        finalLeftItems[0] = { ...finalLeftItems[0], newSourceAmount: finalLeftItems[0].amount + diff }
      }
    }

    // 既存の突合Noの最大値を取得して次の番号を決定
    let maxNo = -1
    for (const e of entries) {
      const no = getReconcileNo(e.note)
      if (no !== null) {
        const num = parseInt(no, 10)
        if (num > maxNo) maxNo = num
      }
    }
    const noStr = String(maxNo + 1).padStart(4, '0')

    const reconciliationItems: any[] = []

    // 発生側の書き込み指示を追加
    for (const leftEntry of finalLeftItems) {
      reconciliationItems.push({
        reconcileNo: noStr,
        sourceSheetName: leftEntry.sourceSheet,
        sourceDate: new Date(leftEntry.date).toISOString(),
        sourceAmount: leftEntry.amount,
        newSourceAmount: leftEntry.newSourceAmount,
        sourceDescription: leftEntry.description,
        settleSheetName: '',
        settleDate: '',
        settleAmount: 0,
        settleDescription: '',
        creditAccount: selectedAccount,
        creditSubAccount: selectedSubAccount
      })
    }

    // 決済側の書き込み指示を追加
    for (const rightEntry of selectedRightItems) {
      reconciliationItems.push({
        reconcileNo: noStr,
        sourceSheetName: '',
        sourceDate: '',
        sourceAmount: 0,
        sourceDescription: '',
        settleSheetName: rightEntry.sourceSheet,
        settleDate: new Date(rightEntry.date).toISOString(),
        settleAmount: rightEntry.amount,
        settleDescription: rightEntry.description,
        creditAccount: selectedAccount,
        creditSubAccount: selectedSubAccount
      })
    }

    setIsReconciling(true)
    setReconcileResult('')
    try {
      // @ts-ignore
      const res = await window.electronAPI.applyReconciliation(reconciliationItems)
      if (res && res.success) {
        await onReload()
        setReconcileResult(`✅ 手動突合を実行しました`)
        setSelectedLeftIds(new Set())
        setSelectedRightIds(new Set())
      } else {
        setReconcileResult(`❌ エラー: ${res?.error || '不明なエラー'}`)
      }
    } catch (err: any) {
      setReconcileResult(`❌ エラー: ${err.message}`)
    } finally {
      setIsReconciling(false)
    }
  }

  // クレジットカードの一括引き落とし確認（科目のセット）
  const handleCreditCardReconciliation = async () => {
    // 選択された決済側明細（指定がなければ右側の未設定全明細を自動対象とする）
    let selectedRightItems = rightEntriesAll.filter(e => selectedRightIds.has(e.id))
    if (selectedRightItems.length === 0) {
      selectedRightItems = rightEntriesAll.filter(e => {
        if (isReconciled(e.note)) return false
        if (e.creditAccount === selectedAccount && e.creditSubAccount === selectedSubAccount) return false
        if (e.debitAccount === selectedAccount && e.debitSubAccount === selectedSubAccount) return false
        return true
      })
    }

    if (selectedRightItems.length === 0) {
      alert('科目をセットする対象の銀行明細（未設定のもの）がありません。')
      return
    }

    const rightTotal = selectedRightItems.reduce((sum, e) => sum + (e.amount || 0), 0)

    // 左側のグループが選択されている場合、金額の差異をチェック
    let confirmMsg = `${selectedRightItems.length}件の銀行明細（合計: ${rightTotal.toLocaleString()}円）の科目を設定シートに基づいてセットします。\n`
    if (selectedCreditGroupKey) {
      const group = creditCardGroups.find(g => g.billingMonthStr === selectedCreditGroupKey)
      if (group) {
        if (group.totalAmount !== rightTotal) {
          confirmMsg += `\n⚠️ クレジットカードの請求額(${group.totalAmount.toLocaleString()}円) と 銀行引き落とし額(${rightTotal.toLocaleString()}円) が一致していません。\n（差額: ${Math.abs(group.totalAmount - rightTotal).toLocaleString()}円）\n`
          // ポイント還元や手数料等の場合は差額が生じます
        } else {
          confirmMsg += `\n✅ 請求額と引き落とし額が一致しています。\n`
        }
      }
    }
    confirmMsg += `\n実行してよろしいですか？`

    if (!window.confirm(confirmMsg)) return

    const reconciliationItems: any[] = []

    for (const rightEntry of selectedRightItems) {
      reconciliationItems.push({
        reconcileNo: "", // 科目セットでは突合Noを割り振らない
        sourceSheetName: '',
        sourceDate: '',
        sourceAmount: 0,
        sourceDescription: '',
        settleSheetName: rightEntry.sourceSheet,
        settleDate: new Date(rightEntry.date).toISOString(),
        settleAmount: rightEntry.amount,
        settleDescription: rightEntry.description,
        creditAccount: '未払金', // クレカ引き落とし時の借方は「未払金」
        creditSubAccount: selectedSubAccount // 選択中のクレカ名
      })
    }

    setIsReconciling(true)
    setReconcileResult('')
    try {
      // @ts-ignore
      const res = await window.electronAPI.applyReconciliation(reconciliationItems)
      if (res && res.success) {
        await onReload()
        setReconcileResult(`✅ 銀行明細に科目をセットしました`)
        setSelectedRightIds(new Set())
        setSelectedCreditGroupKey('')
      } else {
        setReconcileResult(`❌ エラー: ${res?.error || '不明なエラー'}`)
      }
    } catch (err: any) {
      setReconcileResult(`❌ エラー: ${err.message}`)
    } finally {
      setIsReconciling(false)
    }
  }

  // 帳簿残高（負債・資産等の科目特性に合わせて絶対値で計算）
  const rawClosingBalance = currentLedger ? currentLedger.closingBalance : 0
  const bookClosingBalance = isLiability ? Math.abs(rawClosingBalance) : rawClosingBalance

  // 実残高と差額の数値計算
  const parsedActualBalance = actualBalanceInput.trim() !== '' ? parseInt(actualBalanceInput.replace(/,/g, ''), 10) : null
  const diffBalance = parsedActualBalance !== null && !isNaN(parsedActualBalance)
    ? bookClosingBalance - parsedActualBalance
    : null

  // 科目が変わった時に実残高入力欄をクリア
  useEffect(() => {
    setActualBalanceInput('')
  }, [selectedLedgerKey])

  // 差額調整仕訳の追加ハンドラ
  const handleAddAdjustmentEntry = async () => {
    if (diffBalance === null || diffBalance === 0) {
      alert('実残高を入力し、帳簿残高との差額がある場合に実行できます。')
      return
    }

    if (!selectedAccount) {
      alert('対象科目が選択されていません。')
      return
    }

    const absDiff = Math.abs(diffBalance)
    let debitAcc = ''
    let debitSub: string | undefined = undefined
    let creditAcc = ''
    let creditSub: string | undefined = undefined

    const selectedOffsetAcc = (diffBalance < 0 && offsetAccountType === '事業主借') ? '事業主貸' : offsetAccountType

    if (diffBalance > 0) {
      // 帳簿残高 > 実残高: 未払金を減らして実残高に合わせる（貸方に未払金を配置して残高を引き下げる）
      debitAcc = selectedOffsetAcc
      debitSub = undefined
      creditAcc = selectedAccount
      creditSub = selectedSubAccount
    } else {
      // 帳簿残高 < 実残高: 未払金を増やして実残高に合わせる（借方に未払金を配置して残高を引き上げる）
      debitAcc = selectedAccount
      debitSub = selectedSubAccount
      creditAcc = selectedOffsetAcc
      creditSub = undefined
    }

    const subNameLabel = selectedSubAccount ? `::${selectedSubAccount}` : ''
    const confirmMsg = `【期末残高 差額調整仕訳の作成】\n\n` +
      `帳簿残高: ¥${bookClosingBalance.toLocaleString()}\n` +
      `実残高: ¥${parsedActualBalance?.toLocaleString()}\n` +
      `差額: ¥${absDiff.toLocaleString()}\n\n` +
      `以下の仕訳を12/31日付で「仕訳帳」に追加しますか？\n\n` +
      `借方: ${debitAcc}${debitSub ? ` (${debitSub})` : ''}  ¥${absDiff.toLocaleString()}\n` +
      `貸方: ${creditAcc}${creditSub ? ` (${creditSub})` : ''}  ¥${absDiff.toLocaleString()}\n` +
      `摘要: 期末残高差額調整 (${selectedAccount}${subNameLabel})`

    if (!window.confirm(confirmMsg)) return

    setIsAdjusting(true)
    try {
      // @ts-ignore
      const res = await window.electronAPI.addAdjustmentEntry({
        debitAccount: debitAcc,
        debitSubAccount: debitSub,
        creditAccount: creditAcc,
        creditSubAccount: creditSub,
        amount: absDiff,
        description: `期末残高差額調整 (${selectedAccount}${subNameLabel})`,
        note: '期末残高差額調整仕訳'
      })

      if (res && res.success) {
        await onReload()
        setReconcileResult(`✅ 差額調整仕訳（¥${absDiff.toLocaleString()}）を仕訳帳に追加しました`)
        setActualBalanceInput('')
      } else {
        alert('❌ 調整仕訳の追加に失敗しました: ' + (res?.error || '不明なエラー'))
      }
    } catch (err: any) {
      alert('❌ エラー: ' + err.message)
    } finally {
      setIsAdjusting(false)
    }
  }

  // ============================================================
  // 表示フィルタリング（突合済み非表示チェックボックスに連動）
  // ============================================================
  const leftEntries = hideReconciled
    ? leftEntriesAll.filter(e => !isReconciled(e.note))
    : leftEntriesAll

  const rightEntries = hideReconciled
    ? rightEntriesAll.filter(e => !isReconciled(e.note))
    : rightEntriesAll

  // 合計金額の計算
  const leftTotalAmount = leftEntries.reduce((sum, e) => sum + (e.amount || 0), 0)
  const rightTotalAmount = rightEntries.reduce((sum, e) => sum + (e.amount || 0), 0)

  // クレジットカードモード時の月次グループ化
  const creditCardGroups = (() => {
    if (!isCreditCardCheckMode || !selectedSubAccount || targets.length === 0) return []
    const targetInfo = targets.find(t => t.sheetName === selectedSubAccount || t.subAccount === selectedSubAccount)
    if (!targetInfo) return []
    
    const cutoffDay = targetInfo.jsonConfig?.cutoffDay
    const paymentMonthOffset = targetInfo.jsonConfig?.paymentMonthOffset
    const paymentDay = targetInfo.jsonConfig?.paymentDay
    
    const groups: { [key: string]: { billingMonthStr: string, paymentDate: Date, totalAmount: number, entries: any[] } } = {}
    
    leftEntriesAll.forEach(entry => {
      const calcResult = calculatePaymentDate(entry.date, cutoffDay, paymentMonthOffset, paymentDay)
      if (calcResult) {
        const key = calcResult.billingMonthStr
        if (!groups[key]) {
          groups[key] = {
            billingMonthStr: calcResult.billingMonthStr,
            paymentDate: calcResult.paymentDate,
            totalAmount: 0,
            entries: []
          }
        }
        groups[key].totalAmount += entry.amount || 0
        groups[key].entries.push(entry)
      }
    })
    // 支払日でソート
    return Object.values(groups).sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime())
  })()

  // クレジットカードモード時の月次グループ選択状態
  const [selectedCreditGroupKey, setSelectedCreditGroupKey] = useState<string>('')

  // クレジットカードモード時、対応する右側（銀行側）の明細を自動で選択状態にする
  useEffect(() => {
    if (isCreditCardCheckMode) {
      const newRightIds = new Set<string>()
      const group = selectedCreditGroupKey ? creditCardGroups.find(g => g.billingMonthStr === selectedCreditGroupKey) : null
      const groupPayTime = group ? group.paymentDate.getTime() : null

      rightEntriesAll.forEach(e => {
        // すでに突合済みのものは除外
        if (isReconciled(e.note)) return
        // すでに科目が設定されているもの（左上選択の科目・補助科目と同じもの）は除外
        if (e.creditAccount === selectedAccount && e.creditSubAccount === selectedSubAccount) return
        if (e.debitAccount === selectedAccount && e.debitSubAccount === selectedSubAccount) return

        if (groupPayTime) {
          // 月次グループが選択されている場合は日付の近さ（支払日の前後15日以内）を条件とする
          const entryTime = new Date(e.date).getTime()
          const diffDays = Math.abs(entryTime - groupPayTime) / (1000 * 60 * 60 * 24)
          if (diffDays <= 15) {
            newRightIds.add(e.id)
          }
        } else {
          // 月次グループ未選択の場合はキーワードに合致する未設定明細を全件対象とする
          newRightIds.add(e.id)
        }
      })
      setSelectedRightIds(newRightIds)
    }
  }, [selectedCreditGroupKey, isCreditCardCheckMode, rightEntriesAll, creditCardGroups, selectedAccount, selectedSubAccount])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '20px' }}>
      {/* 画面ヘッダー */}
      <div>
        <h2 style={{ marginBottom: '8px' }}>🔍 期末残高チェック</h2>
        <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
          総勘定元帳で期末残高が発生している資産・負債科目を点検し、シート明細や決済先の明細と照合します。
        </p>
      </div>

      {/* ドロップダウンコントロール部 (左右2列) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '24px',
        backgroundColor: 'var(--bg-panel)',
        padding: '20px',
        borderRadius: '12px',
        border: '1px solid var(--border)'
      }}>
        {/* 【左上】科目選択ドロップダウン */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            📌 対象科目（残高のある資産・負債科目）
          </label>
          <select
            value={selectedLedgerKey}
            onChange={(e) => setSelectedLedgerKey(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-base)',
              color: 'var(--text-primary)',
              fontWeight: 'bold'
            }}
          >
            {activeLedgers.map(l => {
              const key = l.subAccountName ? `${l.accountName}::${l.subAccountName}` : l.accountName
              const label = l.subAccountName 
                ? `　└ ${l.subAccountName} (残高: ¥${l.closingBalance.toLocaleString()})`
                : `${l.accountName} (全体残高: ¥${l.closingBalance.toLocaleString()})`
              return <option key={key} value={key}>{label}</option>
            })}
          </select>
          {currentLedger && (
            <div style={{ fontSize: '0.85rem', color: 'var(--accent)', marginTop: '6px', fontWeight: 'bold' }}>
              期末残高: ¥ {currentLedger.closingBalance.toLocaleString()}
            </div>
          )}
        </div>

        {/* 【右上】シート選択ドロップダウン */}
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            💳 照合先の決済先シート
          </label>
          <select
            value={selectedSettleSheet}
            onChange={(e) => setSelectedSettleSheet(e.target.value)}
            disabled={!isSubAccount}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: isSubAccount ? 'var(--bg-base)' : 'var(--bg-hover)',
              color: isSubAccount ? 'var(--text-primary)' : 'var(--text-secondary)'
            }}
          >
            {!isSubAccount ? (
              <option value="">（その他の科目のため選択なし）</option>
            ) : (
              <>
                <option value="">（選択なし）</option>
                {allSheets.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </>
            )}
          </select>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '6px' }}>
            {isSubAccount 
              ? `※「${selectedSubAccount}」の検索キーワードに該当する明細を抽出表示します`
              : '※補助科目を指定した場合に決済先シートが選択可能になります'}
          </div>
        </div>
      </div>

      {/* 期末実残高の入力と差額調整仕訳追加エリア（クレジットカードモードのみ） */}
      {isCreditCardCheckMode && (
        <div style={{
          backgroundColor: 'var(--bg-panel)',
          padding: '16px 20px',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚖️ 期末実残高との差額調整</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
              （WEB明細等で確認した12/31時点の実残高を入力し、差額の調整仕訳を作成します）
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
            {/* 帳簿残高表示 */}
            <div style={{ fontSize: '0.95rem' }}>
              帳簿残高: <strong style={{ color: 'var(--accent)', fontSize: '1.05rem' }}>¥ {bookClosingBalance.toLocaleString()}</strong>
            </div>

            {/* 実残高入力 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>12/31実残高:</label>
              <input
                type="text"
                value={actualBalanceInput}
                onChange={(e) => setActualBalanceInput(e.target.value)}
                placeholder="例: 120000"
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-base)',
                  color: 'var(--text-primary)',
                  width: '140px',
                  fontWeight: 'bold',
                  textAlign: 'right'
                }}
              />
              <span style={{ fontSize: '0.9rem' }}>円</span>
            </div>

            {/* 差額表示 */}
            {diffBalance !== null && (
              <div style={{
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: diffBalance === 0 ? 'rgba(76, 175, 80, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${diffBalance === 0 ? 'rgba(76, 175, 80, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                fontSize: '0.95rem',
                fontWeight: 'bold',
                color: diffBalance === 0 ? '#10b981' : '#ef4444'
              }}>
                {diffBalance === 0 ? '✅ 差額なし (一致)' : `⚠️ 差額: ¥ ${Math.abs(diffBalance).toLocaleString()} (${diffBalance > 0 ? '帳簿超過' : '帳簿不足'})`}
              </div>
            )}

            {/* 相手科目選択 (差額がある場合のみ有効) */}
            {diffBalance !== null && diffBalance !== 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>相手科目:</label>
                <select
                  value={offsetAccountType}
                  onChange={(e) => setOffsetAccountType(e.target.value as any)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--bg-base)',
                    color: 'var(--text-primary)',
                    fontWeight: 'bold'
                  }}
                >
                  <option value="支払手数料">支払手数料 (金利・利息・手数料)</option>
                  <option value="事業主借">事業主借 / 事業主貸 (繰越誤差・個人間調整)</option>
                </select>
              </div>
            )}

            {/* 仕訳追加ボタン */}
            {diffBalance !== null && diffBalance !== 0 && (
              <button
                onClick={handleAddAdjustmentEntry}
                disabled={isAdjusting}
                style={{
                  padding: '8px 20px',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: isAdjusting ? 'not-allowed' : 'pointer',
                  opacity: isAdjusting ? 0.7 : 1,
                  boxShadow: '0 2px 4px rgba(139, 92, 246, 0.2)',
                  transition: 'all 0.2s'
                }}
              >
                {isAdjusting ? '処理中...' : '調整仕訳を仕訳帳に追加'}
              </button>
            )}
          </div>
        </div>
      )}


      {/* コントロールバー（チェックボックス + 突合結果メッセージ） */}
      {!isCreditCardCheckMode && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-panel)',
          padding: '10px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={hideReconciled}
                onChange={(e) => {
                  setHideReconciled(e.target.checked)
                  setSelectedLeftIds(new Set())
                  setSelectedRightIds(new Set())
                }}
                style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
              />
              <span style={{ fontWeight: '500' }}>突合済みの明細は表示しない</span>
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {isReconciling && (
              <span style={{ color: 'var(--accent)', fontSize: '0.9rem' }}>
                ⏳ 突合処理中...
              </span>
            )}
            {reconcileResult && (
              <span style={{ fontSize: '0.9rem' }}>{reconcileResult}</span>
            )}
          </div>
        </div>
      )}

      {/* 手動突合コントロールバー（クレカ残高チェックモード時は非表示） */}
      {!isCreditCardCheckMode && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-hover)',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', gap: '24px', fontSize: '0.95rem' }}>
            <div>選択した発生側合計: <strong style={{ color: 'var(--text-primary)' }}>{
              leftEntries.filter(e => selectedLeftIds.has(e.id)).reduce((s, e) => s + (e.amount || 0), 0).toLocaleString()
            } 円</strong></div>
            <div>選択した決済側合計: <strong style={{ color: 'var(--text-primary)' }}>{
              rightEntries.filter(e => selectedRightIds.has(e.id)).reduce((s, e) => s + (e.amount || 0), 0).toLocaleString()
            } 円</strong></div>
            <div>差額: <strong style={{ color: 'var(--accent)' }}>{
              Math.abs(leftEntries.filter(e => selectedLeftIds.has(e.id)).reduce((s, e) => s + (e.amount || 0), 0) - rightEntries.filter(e => selectedRightIds.has(e.id)).reduce((s, e) => s + (e.amount || 0), 0)).toLocaleString()
            } 円</strong></div>
          </div>
          <button
            onClick={handleManualReconciliation}
            disabled={selectedLeftIds.size === 0 || selectedRightIds.size === 0 || isReconciling}
            style={{
              padding: '8px 24px',
              backgroundColor: selectedLeftIds.size > 0 && selectedRightIds.size > 0 ? 'var(--accent)' : 'var(--bg-panel)',
              color: selectedLeftIds.size > 0 && selectedRightIds.size > 0 ? 'white' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: selectedLeftIds.size > 0 && selectedRightIds.size > 0 ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s'
            }}
          >
            手動突合を実行
          </button>
        </div>
      )}

      {/* クレジットカード残高チェックモード用 コントロールバー */}
      {isCreditCardCheckMode && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          backgroundColor: 'var(--bg-hover)',
          padding: '12px 16px',
          borderRadius: '8px',
          border: '1px solid var(--border)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {isReconciling && (
              <span style={{ color: 'var(--accent)', fontSize: '0.9rem' }}>⏳ 処理中...</span>
            )}
            {reconcileResult && (
              <span style={{ fontSize: '0.9rem' }}>{reconcileResult}</span>
            )}
            <button
              onClick={handleCreditCardReconciliation}
              disabled={isReconciling}
              style={{
                padding: '8px 24px',
                backgroundColor: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              自動科目セットを実行
            </button>
          </div>
        </div>
      )}


      {/* メイン明細テーブルエリア (左右2ペイン) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', height: 'calc(100vh - 380px)', minHeight: '400px' }}>
        {/* 【左下】選択科目の明細一覧 */}
        <div style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '12px 16px',
            backgroundColor: 'var(--bg-hover)',
            borderBottom: '1px solid var(--border)',
            fontWeight: 'bold',
            display: 'flex',
            justifyContent: 'space-between'
          }}>
            <span>📦 明細一覧 ({selectedLedgerKey || '未選択'})</span>
            <span>{leftEntries.length} 件{hideReconciled && leftEntriesAll.length !== leftEntries.length ? ` (全${leftEntriesAll.length}件)` : ''}</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {leftEntries.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                {hideReconciled && leftEntriesAll.length > 0
                  ? '全ての明細が突合済みです。チェックボックスをOFFにすると表示されます。'
                  : '該当する明細データはありません。'}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-panel)', zIndex: 2 }}>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '8px', width: '40px', textAlign: 'center' }}>選択</th>
                    <th style={{ padding: '8px', width: '50px' }}>日付</th>
                    <th style={{ padding: '8px', width: '130px' }}>相手科目 / 補助</th>
                    <th style={{ padding: '8px' }}>摘要</th>
                    <th style={{ padding: '8px', width: '70px', textAlign: 'right' }}>金額</th>
                    <th style={{ padding: '8px', width: '80px' }}>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {leftEntries.map((e, idx) => {
                    // 左側（発生側）の相手先科目の判定
                    let oppAcc = ''
                    let oppSub = ''
                    if (isLiability) {
                      // 未払金等の負債（貸方が主）の場合、相手科目は借方
                      oppAcc = e.debitAccount || ''
                      oppSub = (e.debitSubAccount || '').trim()
                    } else {
                      // 売掛金等の資産（借方が主）の場合、相手科目は貸方
                      oppAcc = e.creditAccount || ''
                      oppSub = (e.creditSubAccount || '').trim()
                    }

                    const reconciled = isReconciled(e.note)
                    const isSelected = selectedLeftIds.has(e.id)
                    return (
                      <tr key={idx} style={{
                        borderBottom: '1px solid var(--border)',
                        backgroundColor: reconciled ? 'rgba(76, 175, 80, 0.08)' : (isSelected ? 'rgba(33, 150, 243, 0.1)' : undefined),
                        opacity: reconciled ? 0.7 : 1
                      }}>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={reconciled || isCreditCardCheckMode}
                            onChange={(ev) => {
                              const newSet = new Set(selectedLeftIds)
                              if (ev.target.checked) newSet.add(e.id)
                              else newSet.delete(e.id)
                              setSelectedLeftIds(newSet)
                            }}
                            style={{ width: '16px', height: '16px', cursor: (reconciled || isCreditCardCheckMode) ? 'not-allowed' : 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatDate(e.date)}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', lineHeight: '1.3' }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{oppAcc}</div>
                          {oppSub && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: '2px' }}>{oppSub}</div>
                          )}
                        </td>
                        <td style={{ padding: '8px', fontWeight: '500' }}>{e.description}</td>
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                          {(e.amount || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {e.note || e.sourceSheet}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot style={{ position: 'sticky', bottom: 0, backgroundColor: 'var(--bg-panel)', zIndex: 2 }}>
                  <tr style={{ borderTop: '2px solid var(--accent)', fontWeight: 'bold', backgroundColor: 'var(--bg-hover)' }}>
                    <td colSpan={4} style={{ padding: '10px 8px', textAlign: 'right' }}>発生金額 合計:</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--accent)', fontSize: '1.05rem' }}>
                      {leftTotalAmount.toLocaleString()}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* 【右下】決済先シートの検索キーワード該当明細一覧 */}
        <div style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '12px 16px',
            backgroundColor: 'var(--bg-hover)',
            borderBottom: '1px solid var(--border)',
            fontWeight: 'bold',
            display: 'flex',
            justifyContent: 'space-between'
          }}>
            <span>💳 決済先明細 ({selectedSettleSheet || '無記入'})</span>
            <span>{rightEntries.length} 件{hideReconciled && rightEntriesAll.length !== rightEntries.length ? ` (全${rightEntriesAll.length}件)` : ''}</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {!selectedSettleSheet ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                決済先シートが選択されていません。
              </div>
            ) : rightEntries.length === 0 ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                {hideReconciled && rightEntriesAll.length > 0
                  ? '全ての明細が突合済みです。チェックボックスをOFFにすると表示されます。'
                  : `キーワード（${searchKeywords.join(', ')}）に該当する決済明細はありません。`}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-panel)', zIndex: 2 }}>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                    {!isCreditCardCheckMode && <th style={{ padding: '8px', width: '40px', textAlign: 'center' }}>選択</th>}
                    <th style={{ padding: '8px', width: '50px' }}>日付</th>
                    <th style={{ padding: '8px', width: '130px' }}>相手科目 / 補助</th>
                    <th style={{ padding: '8px' }}>摘要</th>
                    <th style={{ padding: '8px', width: '70px', textAlign: 'right' }}>金額</th>
                    <th style={{ padding: '8px', width: '80px' }}>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {rightEntries.map((e, idx) => {
                    // 相手先科目の厳密な判定（決済先シート・未払金側ではない反対側の科目を正しく抽出）
                    let oppAcc = ''
                    let oppSub = ''

                    if (e.creditAccount === selectedSettleSheet || e.creditSubAccount === selectedSettleSheet || e.creditAccount === '未払金') {
                      // 通常の出金取引（貸方がカード未払金）の場合、相手先は借方（debit）
                      oppAcc = e.debitAccount || ''
                      oppSub = (e.debitSubAccount || '').trim()
                    } else {
                      // 返金・入金等の場合、相手先は貸方（credit）
                      oppAcc = e.creditAccount || ''
                      oppSub = (e.creditSubAccount || '').trim()
                    }

                    const reconciled = isReconciled(e.note)
                    const isSelected = selectedRightIds.has(e.id)

                    return (
                      <tr key={idx} style={{
                        borderBottom: '1px solid var(--border)',
                        backgroundColor: reconciled ? 'rgba(76, 175, 80, 0.08)' : (isSelected ? 'rgba(33, 150, 243, 0.1)' : undefined),
                        opacity: reconciled ? 0.7 : 1
                      }}>
                        {!isCreditCardCheckMode && (
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={reconciled}
                              onChange={(ev) => {
                                const newSet = new Set(selectedRightIds)
                                if (ev.target.checked) newSet.add(e.id)
                                else newSet.delete(e.id)
                                setSelectedRightIds(newSet)
                              }}
                              style={{ width: '16px', height: '16px', cursor: reconciled ? 'not-allowed' : 'pointer', accentColor: 'var(--accent)' }}
                            />
                          </td>
                        )}
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{formatDate(e.date)}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', lineHeight: '1.3' }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{oppAcc}</div>
                          {oppSub && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: '2px' }}>{oppSub}</div>
                          )}
                        </td>
                        <td style={{ padding: '8px', fontWeight: '500' }}>{e.description}</td>
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>
                          {(e.amount || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {e.note}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot style={{ position: 'sticky', bottom: 0, backgroundColor: 'var(--bg-panel)', zIndex: 2 }}>
                  <tr style={{ borderTop: '2px solid var(--accent)', fontWeight: 'bold', backgroundColor: 'var(--bg-hover)' }}>
                    <td colSpan={isCreditCardCheckMode ? 3 : 4} style={{ padding: '10px 8px', textAlign: 'right' }}>決済明細 合計:</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--accent)', fontSize: '1.05rem' }}>
                      {rightTotalAmount.toLocaleString()}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
