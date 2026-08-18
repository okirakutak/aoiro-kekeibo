import { ImportPlugin, PluginInfo, ImportedTransaction, MappingRule } from '../../src/types/import-plugin'
import { JournalEntry } from '../../src/types/accounting'

/**
 * プラグインマネージャー
 * インポートプラグインの登録・管理・実行を一元的に行うクラス
 */
class PluginManager {
  private plugins: Map<string, ImportPlugin> = new Map()

  /**
   * プラグインを登録する
   * @param plugin 登録するインポートプラグイン
   */
  register(plugin: ImportPlugin): void {
    this.plugins.set(plugin.id, plugin)
  }

  /**
   * 登録済みの全プラグインをクリアする（Excel再読み込み時など）
   */
  clear(): void {
    this.plugins.clear()
  }

  /**
   * 登録済みプラグインの一覧を取得する（フロントエンド用の軽量データ）
   * @returns プラグイン情報の配列
   */
  getPluginList(): PluginInfo[] {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      supportedExtensions: p.supportedExtensions,
      targetSheet: p.targetSheet,
      defaultDebitAccount: p.defaultDebitAccount,
      defaultCreditAccount: p.defaultCreditAccount,
      defaultCreditSubAccount: p.defaultCreditSubAccount
    }))
  }

  /**
   * 指定IDのプラグインを取得する
   * @param id プラグインID
   * @returns プラグインインスタンス、見つからない場合はundefined
   */
  getPlugin(id: string): ImportPlugin | undefined {
    return this.plugins.get(id)
  }

  /**
   * ファイルをパースして取引明細を返す（プレビュー用）
   * @param pluginId 使用するプラグインのID
   * @param filePath パース対象のファイルパス
   * @returns パースされた取引明細の配列
   */
  async parseFile(pluginId: string, filePath: string): Promise<ImportedTransaction[]> {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) throw new Error(`プラグインが見つかりません: ${pluginId}`)
    return plugin.parse(filePath)
  }

  /**
   * 取引明細を仕訳データに変換する
   * @param pluginId 使用するプラグインのID
   * @param transactions 変換対象の取引明細
   * @param mappingRules 科目マッピングルール（任意）
   * @returns 仕訳データの配列
   */
  convertToJournalEntries(
    pluginId: string,
    transactions: ImportedTransaction[],
    mappingRules?: MappingRule[]
  ): JournalEntry[] {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) throw new Error(`プラグインが見つかりません: ${pluginId}`)
    return plugin.toJournalEntries(transactions, mappingRules)
  }
}

// シングルトンインスタンスをエクスポート
export const pluginManager = new PluginManager()
