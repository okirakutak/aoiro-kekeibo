package com.example.aoiro.service

import com.example.aoiro.model.*
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser

// PluginConfig の JSON パース（Gson の JsonParser ベース）
// legacy の config-parser-engine.ts / excel.service.ts が受け付ける JSON 形状に準拠する
object PluginConfigJson {

    fun parse(jsonStr: String): PluginConfig {
        val trimmed = jsonStr.trim()
        val el = JsonParser.parseString(trimmed)
        val obj = when {
            el.isJsonArray -> {
                val arr = el.asJsonArray
                if (arr.size() == 0) throw IllegalArgumentException("空のJSON配列です")
                arr[0].asJsonObject
            }
            el.isJsonObject -> el.asJsonObject
            else -> throw IllegalArgumentException("JSONオブジェクトではありません")
        }
        return fromObject(obj)
    }

    fun parseOrNull(jsonStr: String): PluginConfig? {
        return try {
            parse(jsonStr)
        } catch (e: Exception) {
            null
        }
    }

    fun fromObject(o: JsonObject): PluginConfig {
        val id = str(o, "id") ?: ""
        val name = str(o, "name") ?: ""
        val description = str(o, "description") ?: ""
        val format = str(o, "format") ?: "csv"
        val encoding = str(o, "encoding") ?: "UTF-8"
        val supportedExtensions = strList(o, "supportedExtensions") ?: listOf("csv")
        val multiFile = bool(o, "multiFile") ?: false
        val delimiter = str(o, "delimiter") ?: ","
        val skipRows = int(o, "skipRows") ?: 0
        val hasHeader = bool(o, "hasHeader") ?: true
        val requireBalance = bool(o, "requireBalance") ?: false
        val columns = o.get("columns")?.takeIf { it.isJsonObject }?.asJsonObject?.let { parseColumns(it) }
        val filterYear = int(o, "filterYear")
        val selectors = o.get("selectors")?.takeIf { it.isJsonObject }?.asJsonObject?.let { parseSelectors(it) }
        val htmlMerge = o.get("htmlMerge")?.takeIf { it.isJsonObject }?.asJsonObject?.let {
            val detail = it.get("detailSelectors")?.takeIf { e -> e.isJsonObject }?.asJsonObject?.let { d -> parseSelectors(d) }
            if (detail != null) HtmlMergeConfig(detail, str(it, "matchKey") ?: "orderId") else null
        }
        val datePattern = str(o, "datePattern")
        val amountPattern = str(o, "amountPattern")
        val targetSheet = str(o, "targetSheet") ?: ""
        val sheetLayout = SheetLayout.fromString(str(o, "sheetLayout"))
        val hasOpeningBalance = bool(o, "hasOpeningBalance")
        val cutoffDay = parseDayOrLast(o.get("cutoffDay"))
        val paymentMonthOffset = int(o, "paymentMonthOffset")
        val paymentDay = parseDayOrLast(o.get("paymentDay"))
        val defaultDebitAccount = str(o, "defaultDebitAccount") ?: ""
        val defaultDebitSubAccount = str(o, "defaultDebitSubAccount")
        val defaultCreditAccount = str(o, "defaultCreditAccount") ?: ""
        val defaultCreditSubAccount = str(o, "defaultCreditSubAccount")
        val mappingRules = o.get("mappingRules")?.takeIf { it.isJsonArray }?.asJsonArray?.mapNotNull { e ->
            if (!e.isJsonObject) null else {
                val r = e.asJsonObject
                val keyword = str(r, "keyword") ?: return@mapNotNull null
                val debitAccount = str(r, "debitAccount") ?: return@mapNotNull null
                ConfigMappingRule(
                    keyword = keyword,
                    debitAccount = debitAccount,
                    debitSubAccount = str(r, "debitSubAccount"),
                    creditAccount = str(r, "creditAccount"),
                    creditSubAccount = str(r, "creditSubAccount")
                )
            }
        } ?: emptyList()
        val textPatterns = o.get("textPatterns")?.takeIf { it.isJsonObject }?.asJsonObject?.let {
            val block = str(it, "blockSeparator") ?: return@let null
            val date = str(it, "date") ?: return@let null
            val desc = str(it, "description") ?: return@let null
            val amount = str(it, "amount") ?: return@let null
            TextPatterns(block, date, desc, amount, str(it, "orderId"))
        }
        val type = str(o, "type")
        return PluginConfig(
            id = id, name = name, description = description, format = format,
            encoding = encoding, supportedExtensions = supportedExtensions,
            multiFile = multiFile, delimiter = delimiter, skipRows = skipRows,
            hasHeader = hasHeader, requireBalance = requireBalance, columns = columns,
            filterYear = filterYear, selectors = selectors, htmlMerge = htmlMerge,
            datePattern = datePattern, amountPattern = amountPattern,
            targetSheet = targetSheet, sheetLayout = sheetLayout,
            hasOpeningBalance = hasOpeningBalance, cutoffDay = cutoffDay,
            paymentMonthOffset = paymentMonthOffset, paymentDay = paymentDay,
            defaultDebitAccount = defaultDebitAccount,
            defaultDebitSubAccount = defaultDebitSubAccount,
            defaultCreditAccount = defaultCreditAccount,
            defaultCreditSubAccount = defaultCreditSubAccount,
            mappingRules = mappingRules, textPatterns = textPatterns, type = type
        )
    }

    private fun parseColumns(o: JsonObject): CsvColumnsConfig? {
        val date = o.get("date")?.let { parseColumnSpec(it) } ?: return null
        val description = o.get("description")?.let { parseColumnSpec(it) } ?: return null
        return CsvColumnsConfig(
            date = date,
            description = description,
            income = o.get("income")?.let { parseColumnSpec(it) },
            expense = o.get("expense")?.let { parseColumnSpec(it) },
            amount = o.get("amount")?.let { parseColumnSpec(it) },
            category = o.get("category")?.let { parseColumnSpec(it) },
            balance = o.get("balance")?.let { parseColumnSpec(it) }
        )
    }

    fun parseColumnSpec(el: JsonElement): ColumnSpec {
        if (!el.isJsonObject) throw IllegalArgumentException("ColumnSpec はオブジェクトである必要があります")
        val o = el.asJsonObject
        val idx = o.get("index") ?: throw IllegalArgumentException("ColumnSpec.index がありません")
        return if (idx.isJsonArray) {
            val list = idx.asJsonArray.map { it.asInt }
            ColumnSpec.Joined(list, str(o, "join") ?: "", str(o, "format"))
        } else {
            ColumnSpec.Single(idx.asInt)
        }
    }

    private fun parseSelectors(o: JsonObject): HtmlSelectorsConfig? {
        val row = str(o, "row") ?: return null
        val description = str(o, "description") ?: return null
        val amount = str(o, "amount") ?: return null
        return HtmlSelectorsConfig(
            row = row,
            description = description,
            amount = amount,
            dateText = str(o, "dateText"),
            dateAttr = str(o, "dateAttr"),
            orderId = str(o, "orderId")
        )
    }

    private fun parseDayOrLast(el: JsonElement?): Any? {
        if (el == null || el.isJsonNull) return null
        if (el.isJsonPrimitive) {
            val p = el.asJsonPrimitive
            if (p.isString) {
                val s = p.asString.trim()
                if (s.equals("last", ignoreCase = true) || s.contains("末")) return "last"
                val num = s.filter { it.isDigit() }.toIntOrNull()
                if (num != null && num in 1..31) return num
                return null
            }
            if (p.isNumber) {
                val n = p.asInt
                if (n in 1..31) return n
            }
        }
        return null
    }

    private fun str(o: JsonObject, key: String): String? {
        val e = o.get(key) ?: return null
        if (e.isJsonNull) return null
        return try {
            if (e.isJsonPrimitive) e.asJsonPrimitive.asString else null
        } catch (ex: Exception) {
            null
        }
    }

    private fun int(o: JsonObject, key: String): Int? {
        val e = o.get(key) ?: return null
        if (e.isJsonNull) return null
        return try {
            if (e.isJsonPrimitive) {
                val p = e.asJsonPrimitive
                if (p.isNumber) p.asInt else p.asString.trim().toIntOrNull()
            } else null
        } catch (ex: Exception) {
            null
        }
    }

    private fun bool(o: JsonObject, key: String): Boolean? {
        val e = o.get(key) ?: return null
        if (e.isJsonNull) return null
        return try {
            if (e.isJsonPrimitive) {
                val p = e.asJsonPrimitive
                if (p.isBoolean) p.asBoolean else null
            } else null
        } catch (ex: Exception) {
            null
        }
    }

    private fun strList(o: JsonObject, key: String): List<String>? {
        val e = o.get(key) ?: return null
        if (!e.isJsonArray) return null
        return e.asJsonArray.mapNotNull {
            try {
                if (it.isJsonPrimitive) it.asJsonPrimitive.asString else null
            } catch (ex: Exception) {
                null
            }
        }
    }

    // JsonArray の要素アクセス用ヘルパー
    private operator fun JsonArray.get(index: Int): JsonElement = this[index] as JsonElement
}
