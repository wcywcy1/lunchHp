export interface SettledAdminData<TOrders, TTimestamps> {
    orders: TOrders | null
    timestamps: TTimestamps | null
    ordersError: unknown | null
    timestampsError: unknown | null
}

export async function loadAdminData<TOrders, TTimestamps>(
    loadOrders: () => Promise<TOrders>,
    loadTimestamps: () => Promise<TTimestamps>,
): Promise<SettledAdminData<TOrders, TTimestamps>> {
    const [ordersResult, timestampsResult] = await Promise.allSettled([
        loadOrders(),
        loadTimestamps(),
    ])

    return {
        orders: ordersResult.status === 'fulfilled' ? ordersResult.value : null,
        timestamps: timestampsResult.status === 'fulfilled' ? timestampsResult.value : null,
        ordersError: ordersResult.status === 'rejected' ? ordersResult.reason : null,
        timestampsError: timestampsResult.status === 'rejected' ? timestampsResult.reason : null,
    }
}
