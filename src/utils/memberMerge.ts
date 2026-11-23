export interface MergeMember {
    _id: string
    groupId: string
    name: string
    role: string
    openid?: string
    isVirtual?: boolean
    mergeFromMemberId?: string
    nickName?: string
    avatar?: string
    privacyAgreed?: boolean
    [key: string]: any
}

/** 成员刷新后解析当前用户：旧 memberId 不存在时按 openid 找新身份 */
export function resolveCurrentMember(members: MergeMember[], current: MergeMember | null) {
    if (!current) return null
    const byId = members.find(m => m._id === current._id)
    if (byId) return byId
    if (current.openid) return members.find(m => m.openid === current.openid) || null
    return null
}

/** 合账成功后：移除 target，并把虚拟成员条目替换为 mergedMember */
export function patchMembersAfterMerge(
    members: MergeMember[],
    mergedMember: MergeMember,
    targetMemberId: string,
) {
    const next = members
        .filter(m => m._id !== targetMemberId && m._id !== mergedMember._id)
    next.push(mergedMember)
    return next
}

/** 管理员可选的合账目标：非虚拟、非创建者、不是当前虚拟成员 */
export function filterMergeTargets(members: MergeMember[], virtualMemberId?: string) {
    return members.filter(m => !m.isVirtual && m.role !== 'creator' && m._id !== virtualMemberId)
}

/** 成员编辑弹窗的合账动作：优先继续未完成合账 */
export function getMemberMergeAction(member: MergeMember | null) {
    if (!member) return 'none'
    if (member.mergeFromMemberId) return 'resume'
    return member.isVirtual ? 'select' : 'none'
}
