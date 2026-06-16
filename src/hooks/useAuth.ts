import { computed, ComputedRef } from 'vue'
import { useStore } from '../services/store'
import { ROLE } from '../constants/orderStatus'

interface AuthReturn {
  currentMember: ComputedRef<any>
  currentRole: ComputedRef<string | null>
  isAdmin: ComputedRef<boolean>
  isCreator: ComputedRef<boolean>
  isMember: ComputedRef<boolean>
  canEditMenu: () => boolean
  canManageOrders: () => boolean
}

export function useAuth(): AuthReturn {
    const store = useStore()

    const currentMember = computed(() => store.member)
    const currentRole = computed(() => store.role)

    const isAdmin = computed(() =>
        currentRole.value === ROLE.ADMIN || currentRole.value === ROLE.CREATOR
    )
    const isCreator = computed(() => currentRole.value === ROLE.CREATOR)
    const isMember = computed(() => currentRole.value === ROLE.MEMBER)

    function canEditMenu(): boolean {
        return isAdmin.value
    }

    function canManageOrders(): boolean {
        return isAdmin.value
    }

    return {
        currentMember,
        currentRole,
        isAdmin,
        isCreator,
        isMember,
        canEditMenu,
        canManageOrders,
    }
}