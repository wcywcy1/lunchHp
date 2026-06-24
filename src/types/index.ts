export interface MenuItem {
    _id: string
    supplier: string
    name: string
    price: number
    visible: boolean
    sortNo: number
    [key: string]: any
}

export interface MemberItem {
    _id: string
    name: string
    nickName: string
    isVirtual?: boolean
    [key: string]: any
}

export interface MonthlyStat {
    _id: string
    year: number
    month: number
    totalAmount: number
    orderCount: number
    orderByMember: Record<string, number>
    orderBySupplier: Record<string, number>
    [key: string]: any
}

export interface JoinedGroup {
    groupId: string
    groupName: string
    role: string
    joinedAt: any
}