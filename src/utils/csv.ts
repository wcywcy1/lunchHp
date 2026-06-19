/**
 * CSV 导出工具：解决 Excel 打开格式错乱问题
 * - 字段按 RFC 4180 转义（含逗号/引号/换行时加双引号包裹）
 * - 行尾使用 CRLF（\r\n），兼容 Excel on Windows
 * - 写入 UTF-8 BOM，避免中文乱码
 */

/** 转义单个 CSV 字段 */
export function csvEscape(field: any): string {
    if (field === null || field === undefined) return ''
    const s = String(field)
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
}

/** 将多个字段拼接为一行 CSV */
export function buildCsvLine(fields: any[]): string {
    return fields.map(csvEscape).join(',')
}

/** 将多行 CSV 拼接为完整内容（CRLF 行尾） */
export function buildCsv(lines: string[]): string {
    return lines.join('\r\n')
}

/** 写入带 UTF-8 BOM 的 CSV 文件（微信小程序 FS API） */
export function writeCsvWithBom(fs: any, path: string, content: string) {
    const bytes: number[] = [0xEF, 0xBB, 0xBF]
    for (let i = 0; i < content.length; i++) {
        let code = content.charCodeAt(i)
        if (code >= 0x10000) {
            code -= 0x10000
            bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
        } else if (code >= 0x800) {
            bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
        } else if (code >= 0x80) {
            bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
        } else {
            bytes.push(code)
        }
    }
    fs.writeFileSync(path, new Uint8Array(bytes).buffer as ArrayBuffer)
}
