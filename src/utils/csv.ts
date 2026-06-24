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

/** 是否为 PC 端微信（Windows/Mac） */
export function isPcPlatform(): boolean {
    try {
        const platform = ((wx as any).getSystemInfoSync().platform || '').toLowerCase()
        return platform === 'windows' || platform === 'mac'
    } catch {
        return false
    }
}

export interface ShareResult {
    success: boolean
    message: string
    cancelled?: boolean
}

export interface ChooseFileResult {
    success: boolean
    filePath?: string
    message: string
    cancelled?: boolean
}

/**
 * 选择文件：
 * - PC 端：调用 wx.chooseFile 弹出系统文件选择对话框
 * - 移动端：调用 wx.chooseMessageFile 从微信聊天记录选择
 */
export function chooseFile(extensions: string[]): Promise<ChooseFileResult> {
    return new Promise((resolve) => {
        const wxAny = wx as any
        if (isPcPlatform() && typeof wxAny.chooseFile === 'function') {
            wxAny.chooseFile({
                count: 1,
                type: 'file',
                extension: extensions,
                success: (res: any) => {
                    const file = res.tempFiles?.[0] || res.tempFilePaths?.[0]
                    const filePath = typeof file === 'string' ? file : file?.path
                    if (filePath) {
                        resolve({ success: true, filePath, message: '已选择' })
                    } else {
                        resolve({ success: false, message: '未选择文件' })
                    }
                },
                fail: (err: any) => {
                    if (err?.errMsg?.indexOf('cancel') > -1) {
                        resolve({ success: false, message: '已取消', cancelled: true })
                    } else {
                        resolve({ success: false, message: '选择文件失败' })
                    }
                },
            })
        } else {
            // 移动端：从微信聊天记录选择
            wxAny.chooseMessageFile({
                count: 1,
                type: 'file',
                extension: extensions,
                success: (res: any) => {
                    const filePath = res.tempFiles?.[0]?.path
                    if (filePath) {
                        resolve({ success: true, filePath, message: '已选择' })
                    } else {
                        resolve({ success: false, message: '未选择文件' })
                    }
                },
                fail: (err: any) => {
                    if (err?.errMsg?.indexOf('cancel') > -1) {
                        resolve({ success: false, message: '已取消', cancelled: true })
                    } else {
                        resolve({ success: false, message: '选择文件失败' })
                    }
                },
            })
        }
    })
}

/**
 * 分享或保存文件：
 * - PC 端：调用 wx.saveFileToDisk 弹出"另存为"对话框
 * - 移动端：调用 wx.shareFileMessage 分享到微信
 */
export function shareOrSaveFile(filePath: string, fileName: string): Promise<ShareResult> {
    return new Promise((resolve) => {
        if (isPcPlatform()) {
            // PC 端：保存到磁盘
            const wxAny = wx as any
            if (typeof wxAny.saveFileToDisk === 'function') {
                wxAny.saveFileToDisk({
                    filePath,
                    fileName,
                    success: () => resolve({ success: true, message: '保存成功', cancelled: false }),
                    fail: (err: any) => {
                        if (err?.errMsg?.indexOf('cancel') > -1) {
                            resolve({ success: false, message: '已取消', cancelled: true })
                        } else {
                            // saveFileToDisk 可用但调用失败，直接返回错误，避免回退导致二次弹窗
                            resolve({ success: false, message: '保存失败', cancelled: false })
                        }
                    },
                })
            } else {
                // saveFileToDisk 不存在（老版本 PC 微信），回退到 openDocument
                wxAny.openDocument({
                    filePath,
                    fileType: 'csv',
                    showMenu: true,
                    success: () => resolve({ success: true, message: '已打开', cancelled: false }),
                    fail: () => resolve({ success: false, message: '保存失败', cancelled: false }),
                })
            }
        } else {
            // 移动端：分享到微信
            wx.shareFileMessage({
                filePath,
                fileName,
                success: () => resolve({ success: true, message: '分享成功', cancelled: false }),
                fail: (err: any) => {
                    if (err?.errMsg?.indexOf('cancel') > -1) {
                        resolve({ success: false, message: '分享已取消', cancelled: true })
                    } else {
                        resolve({ success: false, message: '分享失败', cancelled: false })
                    }
                },
            })
        }
    })
}