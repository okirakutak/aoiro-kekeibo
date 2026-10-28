package com.example.aoiro

import com.example.aoiro.model.*
import com.example.aoiro.service.ExcelImportService
import com.example.aoiro.service.ExcelLoader
import com.example.aoiro.service.FinancialReportService
import com.example.aoiro.service.ImportParserService
import com.example.aoiro.service.LedgerService
import com.example.aoiro.service.PluginConfigJson
import javafx.beans.property.SimpleStringProperty
import javafx.collections.FXCollections
import javafx.fxml.FXML
import javafx.scene.control.*
import javafx.scene.input.Clipboard
import javafx.scene.input.ClipboardContent
import javafx.scene.layout.HBox
import javafx.scene.layout.VBox
import javafx.stage.FileChooser
import javafx.util.StringConverter
import java.io.File
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainController {

    // ナビゲーション
    @FXML private lateinit var btnNavJournal: Button
    @FXML private lateinit var btnNavLedger: Button
    @FXML private lateinit var btnNavPL: Button
    @FXML private lateinit var btnNavBS: Button
    @FXML private lateinit var btnNavImport: Button
    @FXML private lateinit var btnOpenExcel: Button

    // コンテナ
    @FXML private lateinit var emptyCard: VBox
    @FXML private lateinit var journalContainer: VBox
    @FXML private lateinit var ledgerContainer: VBox
    @FXML private lateinit var plContainer: VBox
    @FXML private lateinit var bsContainer: VBox
    @FXML private lateinit var importContainer: VBox

    // 仕訳帳
    @FXML private lateinit var lblJournalCount: Label
    @FXML private lateinit var journalTable: TableView<JournalEntry>
    @FXML private lateinit var colDate: TableColumn<JournalEntry, String>
    @FXML private lateinit var colDebit: TableColumn<JournalEntry, String>
    @FXML private lateinit var colCredit: TableColumn<JournalEntry, String>
    @FXML private lateinit var colAmount: TableColumn<JournalEntry, String>
    @FXML private lateinit var colDescription: TableColumn<JournalEntry, String>
    @FXML private lateinit var colSourceSheet: TableColumn<JournalEntry, String>

    // 総勘定元帳
    @FXML private lateinit var cmbLedgerAccount: ComboBox<AccountLedger>
    @FXML private lateinit var ledgerTable: TableView<LedgerEntry>
    @FXML private lateinit var colLedgerDate: TableColumn<LedgerEntry, String>
    @FXML private lateinit var colLedgerOpponent: TableColumn<LedgerEntry, String>
    @FXML private lateinit var colLedgerDesc: TableColumn<LedgerEntry, String>
    @FXML private lateinit var colLedgerDebit: TableColumn<LedgerEntry, String>
    @FXML private lateinit var colLedgerCredit: TableColumn<LedgerEntry, String>
    @FXML private lateinit var colLedgerBalance: TableColumn<LedgerEntry, String>
    @FXML private lateinit var lblLedgerTotalDebit: Label
    @FXML private lateinit var lblLedgerTotalCredit: Label
    @FXML private lateinit var lblLedgerClosingBalance: Label

    // 損益計算書 (PL)
    @FXML private lateinit var tblPLExpenses: TableView<ReportRow>
    @FXML private lateinit var colPLExpenseName: TableColumn<ReportRow, String>
    @FXML private lateinit var colPLExpenseAmount: TableColumn<ReportRow, String>
    @FXML private lateinit var lblPLTotalExpense: Label

    @FXML private lateinit var tblPLRevenues: TableView<ReportRow>
    @FXML private lateinit var colPLRevenueName: TableColumn<ReportRow, String>
    @FXML private lateinit var colPLRevenueAmount: TableColumn<ReportRow, String>
    @FXML private lateinit var lblPLTotalRevenue: Label

    // 貸借対照表 (BS)
    @FXML private lateinit var tblBSAssets: TableView<ReportRow>
    @FXML private lateinit var colBSAssetName: TableColumn<ReportRow, String>
    @FXML private lateinit var colBSAssetAmount: TableColumn<ReportRow, String>
    @FXML private lateinit var lblBSTotalAsset: Label

    @FXML private lateinit var tblBSLiabilities: TableView<ReportRow>
    @FXML private lateinit var colBSLiabilityName: TableColumn<ReportRow, String>
    @FXML private lateinit var colBSLiabilityAmount: TableColumn<ReportRow, String>
    @FXML private lateinit var lblBSTotalLiability: Label

    // データインポート
    @FXML private lateinit var lstImportSheets: ListView<String>
    @FXML private lateinit var lblImportInfo: Label
    @FXML private lateinit var importSetupCard: VBox
    @FXML private lateinit var lblImportSheetName: Label
    @FXML private lateinit var lblImportAccount: Label
    @FXML private lateinit var lblImportStatus: Label
    @FXML private lateinit var lblImportJsonDetail: Label
    @FXML private lateinit var lblImportWarningDesc: Label
    @FXML private lateinit var rdoFormatHtml: RadioButton
    @FXML private lateinit var rdoFormatCsv: RadioButton
    @FXML private lateinit var rdoModeJson: RadioButton
    @FXML private lateinit var rdoModeDirect: RadioButton
    @FXML private lateinit var importFormatBox: HBox
    @FXML private lateinit var btnImportPreview: Button
    @FXML private lateinit var btnImportExtract: Button
    @FXML private lateinit var importStepPane: VBox
    @FXML private lateinit var importPastePane: VBox
    @FXML private lateinit var importPreviewPane: VBox
    @FXML private lateinit var txtImportAiInput: TextArea
    @FXML private lateinit var lblImportPreviewCount: Label
    @FXML private lateinit var tblImportPreview: TableView<ImportedTransaction>
    @FXML private lateinit var colImportDate: TableColumn<ImportedTransaction, String>
    @FXML private lateinit var colImportDesc: TableColumn<ImportedTransaction, String>
    @FXML private lateinit var colImportAccount: TableColumn<ImportedTransaction, String>
    @FXML private lateinit var colImportAmount: TableColumn<ImportedTransaction, String>

    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy/MM/dd")
    private val numberFormatter = NumberFormat.getNumberInstance(Locale.JAPAN)

    private var currentEntries: List<JournalEntry> = emptyList()
    private var currentLedgers: List<AccountLedger> = emptyList()
    private var currentPL: PLData? = null
    private var currentBS: BSData? = null
    private var activeTab: String = "journal"
    private var currentExcelFile: File? = null
    private var importTargets: List<ImportTargetSheet> = emptyList()
    private var importPreview: List<ImportedTransaction> = emptyList()
    private var importPreviewIsTsv: Boolean = false
    private var pendingImportFiles: List<File> = emptyList()
    private var importStep: String = "setup" // "setup" | "paste" | "preview"
    // ToggleGroupはフィールドで保持する（ローカル変数だとGC回収され選択不能になる）
    private val importFormatGroup = ToggleGroup()
    private val importModeGroup = ToggleGroup()

    @FXML
    fun initialize() {
        // 仕訳帳 TableColumn のバインド
        colDate.setCellValueFactory { cellData -> SimpleStringProperty(cellData.value.date.format(dateFormatter)) }
        colDebit.setCellValueFactory { cellData -> SimpleStringProperty(cellData.value.debitFormatted) }
        colCredit.setCellValueFactory { cellData -> SimpleStringProperty(cellData.value.creditFormatted) }
        colAmount.setCellValueFactory { cellData -> SimpleStringProperty(numberFormatter.format(cellData.value.amount)) }
        colDescription.setCellValueFactory { cellData -> SimpleStringProperty(cellData.value.description) }
        colSourceSheet.setCellValueFactory { cellData -> SimpleStringProperty(cellData.value.sourceSheet) }
        colAmount.styleClass.add("table-cell-amount")

        // 総勘定元帳 TableColumn のバインド
        colLedgerDate.setCellValueFactory { cellData ->
            val d = cellData.value.date
            SimpleStringProperty(d?.format(dateFormatter) ?: "")
        }
        colLedgerOpponent.setCellValueFactory { cellData -> SimpleStringProperty(cellData.value.opponentFormatted) }
        colLedgerDesc.setCellValueFactory { cellData -> SimpleStringProperty(cellData.value.description) }
        colLedgerDebit.setCellValueFactory { cellData ->
            val amt = cellData.value.debitAmount
            SimpleStringProperty(if (amt > 0) numberFormatter.format(amt) else "")
        }
        colLedgerCredit.setCellValueFactory { cellData ->
            val amt = cellData.value.creditAmount
            SimpleStringProperty(if (amt > 0) numberFormatter.format(amt) else "")
        }
        colLedgerBalance.setCellValueFactory { cellData -> SimpleStringProperty(numberFormatter.format(cellData.value.balance)) }

        colLedgerDebit.styleClass.add("table-cell-amount")
        colLedgerCredit.styleClass.add("table-cell-amount")
        colLedgerBalance.styleClass.add("table-cell-amount")

        // ComboBox コンバーター設定
        cmbLedgerAccount.converter = object : StringConverter<AccountLedger>() {
            override fun toString(ledger: AccountLedger?): String = ledger?.displayName ?: ""
            override fun fromString(string: String?): AccountLedger? = null
        }

        // PL / BS TableColumn バインド設定
        setupReportColumns(colPLExpenseName, colPLExpenseAmount)
        setupReportColumns(colPLRevenueName, colPLRevenueAmount)
        setupReportColumns(colBSAssetName, colBSAssetAmount)
        setupReportColumns(colBSLiabilityName, colBSLiabilityAmount)

        // データインポート UI の初期化
        setupImportPanel()
    }

    private fun setupReportColumns(nameCol: TableColumn<ReportRow, String>, amountCol: TableColumn<ReportRow, String>) {
        nameCol.setCellValueFactory { SimpleStringProperty(it.value.accountName) }
        amountCol.setCellValueFactory { SimpleStringProperty(numberFormatter.format(it.value.amount)) }
        amountCol.styleClass.add("table-cell-amount")

        // 当期純利益 / 損失の行ハイライト
        val customCellFactory = { _: TableColumn<ReportRow, String> ->
            object : TableCell<ReportRow, String>() {
                override fun updateItem(item: String?, empty: Boolean) {
                    super.updateItem(item, empty)
                    if (empty || item == null) {
                        text = null
                        styleClass.removeAll("text-profit", "text-loss")
                    } else {
                        text = item
                        val row = tableRow?.item
                        if (row != null && row.isProfitLossHighlight) {
                            if (row.isProfit) {
                                styleClass.add("text-profit")
                            } else {
                                styleClass.add("text-loss")
                            }
                        } else {
                            styleClass.removeAll("text-profit", "text-loss")
                        }
                    }
                }
            }
        }

        nameCol.setCellFactory(customCellFactory)
        amountCol.setCellFactory(customCellFactory)
    }

    @FXML
    fun showJournalTab() {
        activeTab = "journal"
        updateNavButtons()
        updateViewVisibility()
    }

    @FXML
    fun showLedgerTab() {
        activeTab = "ledger"
        updateNavButtons()
        updateViewVisibility()
    }

    @FXML
    fun showPLTab() {
        activeTab = "pl"
        updateNavButtons()
        updateViewVisibility()
    }

    @FXML
    fun showBSTab() {
        activeTab = "bs"
        updateNavButtons()
        updateViewVisibility()
    }

    @FXML
    fun showImportTab() {
        activeTab = "import"
        updateNavButtons()
        refreshImportTargets()
        updateViewVisibility()
    }

    private fun updateNavButtons() {
        btnNavJournal.styleClass.setAll("nav-button", if (activeTab == "journal") "active" else "")
        btnNavLedger.styleClass.setAll("nav-button", if (activeTab == "ledger") "active" else "")
        btnNavPL.styleClass.setAll("nav-button", if (activeTab == "pl") "active" else "")
        btnNavBS.styleClass.setAll("nav-button", if (activeTab == "bs") "active" else "")
        btnNavImport.styleClass.setAll("nav-button", if (activeTab == "import") "active" else "")
    }

    @FXML
    fun handleOpenExcel() {
        val fileChooser = FileChooser().apply {
            title = "Excelファイルを選択"
            extensionFilters.addAll(
                FileChooser.ExtensionFilter("Excel Files (*.xlsx, *.xls)", "*.xlsx", "*.xls"),
                FileChooser.ExtensionFilter("All Files", "*.*")
            )
        }

        val window = btnOpenExcel.scene.window
        val selectedFile = fileChooser.showOpenDialog(window) ?: return

        try {
            currentExcelFile = selectedFile
            currentEntries = ExcelLoader.loadJournalEntries(selectedFile)
            val accountOrder = ExcelLoader.loadAccountOrder(selectedFile)
            val accountTypes = ExcelLoader.loadAccountTypes(selectedFile)
            currentLedgers = LedgerService.generateLedgers(currentEntries, accountOrder)
            currentPL = FinancialReportService.generatePL(currentLedgers, accountTypes)
            currentBS = FinancialReportService.generateBS(currentLedgers, currentPL?.netIncome ?: 0L, accountTypes)

            displayData()
        } catch (e: Exception) {
            e.printStackTrace()
            val alert = Alert(Alert.AlertType.ERROR).apply {
                title = "エラー"
                headerText = "ファイルの読み込みに失敗しました"
                contentText = e.message
            }
            alert.showAndWait()
        }
    }

    @FXML
    fun handleLedgerAccountChange() {
        val selected = cmbLedgerAccount.value ?: return
        displayLedgerDetail(selected)
    }

    private fun displayData() {
        // 1. 仕訳帳
        journalTable.items = FXCollections.observableArrayList(currentEntries)
        lblJournalCount.text = "仕訳帳 (${currentEntries.size} 件)"

        // 2. 総勘定元帳
        cmbLedgerAccount.items = FXCollections.observableArrayList(currentLedgers)
        if (currentLedgers.isNotEmpty()) {
            cmbLedgerAccount.value = currentLedgers.first()
            displayLedgerDetail(currentLedgers.first())
        }

        // 3. 損益計算書 (PL)
        currentPL?.let { pl ->
            tblPLExpenses.items = FXCollections.observableArrayList(pl.expenseRows)
            tblPLRevenues.items = FXCollections.observableArrayList(pl.revenueRows)
            lblPLTotalExpense.text = numberFormatter.format(pl.finalExpenseTotal)
            lblPLTotalRevenue.text = numberFormatter.format(pl.finalRevenueTotal)
        }

        // 4. 貸借対照表 (BS)
        currentBS?.let { bs ->
            tblBSAssets.items = FXCollections.observableArrayList(bs.assetRows)
            tblBSLiabilities.items = FXCollections.observableArrayList(bs.liabilityRows)
            lblBSTotalAsset.text = numberFormatter.format(bs.finalAssetTotal)
            lblBSTotalLiability.text = numberFormatter.format(bs.finalLiabilityTotal)
        }

        updateViewVisibility()
    }

    private fun displayLedgerDetail(ledger: AccountLedger) {
        val rows = mutableListOf<LedgerEntry>()

        rows.add(
            LedgerEntry(
                date = null,
                opponentAccount = "",
                opponentSubAccount = null,
                description = "前期繰越",
                debitAmount = 0L,
                creditAmount = 0L,
                balance = ledger.openingBalance
            )
        )

        rows.addAll(ledger.entries)

        ledgerTable.items = FXCollections.observableArrayList(rows)

        lblLedgerTotalDebit.text = "借方計: ${numberFormatter.format(ledger.totalDebit)}"
        lblLedgerTotalCredit.text = "貸方計: ${numberFormatter.format(ledger.totalCredit)}"
        lblLedgerClosingBalance.text = "最終残高: ${numberFormatter.format(ledger.closingBalance)}"
    }

    private fun updateViewVisibility() {
        val hasData = currentEntries.isNotEmpty()
        emptyCard.isVisible = !hasData
        emptyCard.isManaged = !hasData

        val showJournal = hasData && activeTab == "journal"
        journalContainer.isVisible = showJournal
        journalContainer.isManaged = showJournal

        val showLedger = hasData && activeTab == "ledger"
        ledgerContainer.isVisible = showLedger
        ledgerContainer.isManaged = showLedger

        val showPL = hasData && activeTab == "pl"
        plContainer.isVisible = showPL
        plContainer.isManaged = showPL

        val showBS = hasData && activeTab == "bs"
        bsContainer.isVisible = showBS
        bsContainer.isManaged = showBS

        val showImport = activeTab == "import"
        importContainer.isVisible = showImport
        importContainer.isManaged = showImport
        if (showImport && !hasData) {
            emptyCard.isVisible = false
            emptyCard.isManaged = false
        }
    }

    // ===== データインポート（legacy ImportPanel の移植） =====

    private fun setupImportPanel() {
        // ファイル形式・処理モードのラジオボタンをトグルグループ化（フィールド保持）
        rdoFormatHtml.toggleGroup = importFormatGroup
        rdoFormatCsv.toggleGroup = importFormatGroup
        rdoModeJson.toggleGroup = importModeGroup
        rdoModeDirect.toggleGroup = importModeGroup
        colImportDate.setCellValueFactory { SimpleStringProperty(it.value.date.format(dateFormatter)) }
        colImportDesc.setCellValueFactory { SimpleStringProperty(it.value.description) }
        colImportAccount.setCellValueFactory { SimpleStringProperty(it.value.creditAccount ?: it.value.debitAccount ?: "") }
        colImportAmount.setCellValueFactory { SimpleStringProperty(numberFormatter.format(it.value.amount) + "円") }
        colImportAmount.styleClass.add("table-cell-amount")
        lstImportSheets.selectionModel.selectedItemProperty().addListener { _, _, _ -> updateImportInfo() }
    }

    private fun selectedImportTarget(): ImportTargetSheet? {
        val idx = lstImportSheets.selectionModel.selectedIndex
        return importTargets.getOrNull(idx)
    }

    private fun updateImportStep() {
        importStepPane.isVisible = importStep == "setup"
        importStepPane.isManaged = importStep == "setup"
        importPastePane.isVisible = importStep == "paste"
        importPastePane.isManaged = importStep == "paste"
        importPreviewPane.isVisible = importStep == "preview"
        importPreviewPane.isManaged = importStep == "preview"
    }

    private fun refreshImportTargets() {
        val excelFile = currentExcelFile
        if (excelFile == null) {
            lblImportInfo.isVisible = true
            lblImportInfo.isManaged = true
            lblImportInfo.text = "先に「Open Excel File」でExcelファイルを読み込んでください。"
            importSetupCard.isVisible = false
            importSetupCard.isManaged = false
            importStep = "setup"
            updateImportStep()
            return
        }
        try {
            importTargets = ExcelImportService.getImportTargets(excelFile)
            lstImportSheets.items = FXCollections.observableArrayList(importTargets.map {
                it.sheetName + if (it.hasJson) " ⚙️自動" else " 🤖AI"
            })
            // 選択はシート名で復元するため表示名からシート名を抽出する
            lstImportSheets.selectionModel.clearSelection()
            if (importTargets.isNotEmpty()) {
                lstImportSheets.selectionModel.select(0)
            } else {
                lblImportInfo.isVisible = true
            lblImportInfo.isManaged = true
                lblImportInfo.text = "対象となるワークシートがありません。"
                importSetupCard.isVisible = false
                importSetupCard.isManaged = false
            }
        } catch (e: Exception) {
            lblImportInfo.isVisible = true
            lblImportInfo.isManaged = true
            lblImportInfo.text = "対象の取得に失敗しました: ${e.message}"
            importSetupCard.isVisible = false
            importSetupCard.isManaged = false
        }
    }

    private fun updateImportInfo() {
        val idx = lstImportSheets.selectionModel.selectedIndex
        val target = importTargets.getOrNull(idx) ?: return
        importPreview = emptyList()
        txtImportAiInput.clear()
        pendingImportFiles = emptyList()
        tblImportPreview.items = FXCollections.observableArrayList(emptyList<ImportedTransaction>())
        lblImportPreviewCount.text = "インポートデータのプレビュー (0件)"
        // 対象が存在するためエラーラベルは隠してカードを表示する
        lblImportInfo.isVisible = false
        lblImportInfo.isManaged = false
        importSetupCard.isVisible = true
        importSetupCard.isManaged = true
        lblImportSheetName.text = target.sheetName
        val subAccount = target.subAccount?.takeIf { it.isNotEmpty() }?.let { "　対象補助科目: $it" } ?: ""
        lblImportAccount.text = "対象科目: ${target.account}$subAccount"
        if (target.hasJson) {
            val cfg = target.jsonConfig
            lblImportStatus.styleClass.removeAll("text-warning")
            lblImportStatus.styleClass.add("text-success")
            lblImportStatus.text = "✓ インポート設定(JSON) 登録済み"
            lblImportJsonDetail.isVisible = true
            lblImportJsonDetail.isManaged = true
            lblImportJsonDetail.text = "対象形式: ${cfg?.format?.uppercase() ?: "CSV"}\n文字コード: ${cfg?.encoding ?: "UTF-8"}"
            lblImportWarningDesc.isVisible = false
            lblImportWarningDesc.isManaged = false
            importFormatBox.isVisible = false
            importFormatBox.isManaged = false
            btnImportPreview.isVisible = true
            btnImportPreview.isManaged = true
            btnImportPreview.isDisable = false
            btnImportExtract.isVisible = false
            btnImportExtract.isManaged = false
        } else {
            lblImportStatus.styleClass.removeAll("text-success")
            lblImportStatus.styleClass.add("text-warning")
            lblImportStatus.text = "⚠️ インポート設定(JSON) 未登録"
            lblImportJsonDetail.isVisible = false
            lblImportJsonDetail.isManaged = false
            lblImportWarningDesc.isVisible = true
            lblImportWarningDesc.isManaged = true
            lblImportWarningDesc.text = "設定がないため、AIを活用して自動化します。\n対象ファイルの形式と処理モードを選択してください。"
            importFormatBox.isVisible = true
            importFormatBox.isManaged = true
            btnImportPreview.isVisible = false
            btnImportPreview.isManaged = false
            btnImportExtract.isVisible = true
            btnImportExtract.isManaged = true
            btnImportExtract.isDisable = false
        }
        importStep = "setup"
        updateImportStep()
    }

    @FXML
    fun handleImportPreview() {
        val idx = lstImportSheets.selectionModel.selectedIndex
        val target = importTargets.getOrNull(idx) ?: return
        val config = target.jsonConfig ?: return
        val chooser = FileChooser().apply { title = "インポートファイルを選択（複数可）" }
        val window = btnImportPreview.scene.window
        val files = chooser.showOpenMultipleDialog(window) ?: return
        try {
            val txs = ImportParserService.parseFiles(config, files)
            importPreview = txs
            importPreviewIsTsv = false
            pendingImportFiles = files
            tblImportPreview.items = FXCollections.observableArrayList(txs)
            lblImportPreviewCount.text = "インポートデータのプレビュー (${txs.size}件)"
            importStep = "preview"
            updateImportStep()
        } catch (e: Exception) {
            showAlert("❌ エラー", "ファイルの解析に失敗しました。")
        }
    }

    @FXML
    fun handleImportExtract() {
        val idx = lstImportSheets.selectionModel.selectedIndex
        val target = importTargets.getOrNull(idx) ?: return
        val isHtml = rdoFormatHtml.isSelected
        val chooser = FileChooser().apply { title = "対象ファイルを選択" }
        val window = btnImportExtract.scene.window
        val files = if (isHtml) {
            chooser.showOpenMultipleDialog(window) ?: return
        } else {
            val single = chooser.showOpenDialog(window) ?: return
            listOf(single)
        }
        try {
            val extracted = ExcelImportService.extractTextFromFiles(files)
            pendingImportFiles = extracted.filePaths
            val isJsonMode = rdoModeJson.isSelected
            val prompt = if (isJsonMode) {
                ExcelImportService.buildJsonPrompt(target, extracted.combinedText)
            } else {
                ExcelImportService.buildTsvPrompt(target, extracted.combinedText)
            }
            val content = ClipboardContent()
            content.putString(prompt)
            Clipboard.getSystemClipboard().setContent(content)
            // モードに応じてプレースホルダーを切り替える（React版と同等）
            txtImportAiInput.promptText = if (isJsonMode) {
                "```json\n{\n  ...\n}\n```"
            } else {
                "2024/01/01\t通信費\t\tインターネット代\t5000\n..."
            }
            showInfo("AIへの指示用プロンプトをクリップボードにコピーしました！", "お使いのAI（ChatGPT等）に貼り付け、出力された結果をこの後のテキストボックスに貼り付けてください。")
            importStep = "paste"
            updateImportStep()
        } catch (e: Exception) {
            showAlert("❌ エラー", "テキスト抽出に失敗しました。")
        }
    }

    @FXML
    fun handleImportAiNext() {
        importTargets.getOrNull(lstImportSheets.selectionModel.selectedIndex) ?: return
        val input = txtImportAiInput.text ?: ""
        if (input.isBlank()) return
        val isJsonMode = rdoModeJson.isSelected
        try {
            if (isJsonMode) {
                var jsonStr = input.trim()
                if (jsonStr.startsWith("```json")) {
                    jsonStr = jsonStr.replace("```json", "").replace("```", "").trim()
                }
                PluginConfigJson.parse(jsonStr)
                val (txs, _) = ExcelImportService.previewWithJson(jsonStr, pendingImportFiles)
                importPreview = txs
                importPreviewIsTsv = false
                txtImportAiInput.text = jsonStr
            } else {
                importPreview = ImportParserService.parseTsvDirect(input)
                importPreviewIsTsv = true
            }
            tblImportPreview.items = FXCollections.observableArrayList(importPreview)
            lblImportPreviewCount.text = "インポートデータのプレビュー (${importPreview.size}件)"
            importStep = "preview"
            updateImportStep()
        } catch (e: Exception) {
            showAlert("❌ エラー", "データの解析に失敗しました。フォーマットを確認してください。")
        }
    }

    @FXML
    fun handleImportSave() {
        val idx = lstImportSheets.selectionModel.selectedIndex
        val target = importTargets.getOrNull(idx) ?: return
        val excelFile = currentExcelFile ?: return
        if (importPreview.isEmpty()) return
        try {
            if (!importPreviewIsTsv) {
                val jsonStr = txtImportAiInput.text?.trim() ?: ""
                if (jsonStr.startsWith("{")) {
                    ExcelImportService.savePluginConfig(excelFile, target.sheetName, jsonStr)
                }
            }
            val config = target.jsonConfig
            val count = ExcelImportService.writeTransactionsToSheet(
                excelFile, target.sheetName, importPreview,
                layoutParam = config?.sheetLayout,
                hasOpeningBalance = config?.hasOpeningBalance
            )
            refreshImportTargets()
            // 保存後に仕訳帳を再読み込みして表示を更新
            currentEntries = ExcelLoader.loadJournalEntries(excelFile)
            val accountOrder = ExcelLoader.loadAccountOrder(excelFile)
            val accountTypes = ExcelLoader.loadAccountTypes(excelFile)
            currentLedgers = LedgerService.generateLedgers(currentEntries, accountOrder)
            currentPL = FinancialReportService.generatePL(currentLedgers, accountTypes)
            currentBS = FinancialReportService.generateBS(currentLedgers, currentPL?.netIncome ?: 0L, accountTypes)
            displayData()
            showInfo("✅ 保存完了", "${count}件のデータを「${target.sheetName}」シートに転記しました。")
        } catch (e: Exception) {
            showAlert("❌ エラー", e.message)
        }
    }

    @FXML
    fun handleImportCancel() {
        importPreview = emptyList()
        pendingImportFiles = emptyList()
        txtImportAiInput.clear()
        tblImportPreview.items = FXCollections.observableArrayList(emptyList<ImportedTransaction>())
        lblImportPreviewCount.text = "インポートデータのプレビュー (0件)"
        importStep = "setup"
        updateImportStep()
        updateImportInfo()
    }

    private fun showAlert(header: String, content: String?) {
        val alert = Alert(Alert.AlertType.ERROR).apply {
            title = "エラー"
            headerText = header
            contentText = content
        }
        alert.showAndWait()
    }

    private fun showInfo(header: String, content: String?) {
        val alert = Alert(Alert.AlertType.INFORMATION).apply {
            title = "情報"
            headerText = header
            contentText = content
        }
        alert.showAndWait()
    }
}
