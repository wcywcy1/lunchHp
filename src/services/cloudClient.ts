import { CLOUD_ENV } from '../constants/appConfig'

let db: any = null

export function initCloud() {
    if (!wx.cloud) {
        console.error('请使用 2.25.3 或以上的基础库以使用云能力')
        return
    }
    wx.cloud.init({
        env: CLOUD_ENV,
        traceUser: true,
    })
    db = wx.cloud.database()
}

export function getDB() {
    if (!db) {
        initCloud()
    }
    return db
}