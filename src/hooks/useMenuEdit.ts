import { ref, Ref } from 'vue'
import { menuAction } from '../services/repositories/baseRepository'

interface EditForm {
    menuId: string
    supplier: string
    name: string
    price: string
    photo: string
}

interface MenuItem {
    _id: string
    supplier: string
    name: string
    price: number
    photo?: string
    [key: string]: any
}

interface MenuEditReturn {
    editLoading: Ref<boolean>
    showEditModal: Ref<boolean>
    editForm: Ref<EditForm>
    isEdit: Ref<boolean>
    openAdd: () => void
    openEdit: (item: MenuItem) => void
    closeEditModal: () => void
    saveItem: () => Promise<void>
    deleteItem: (menuId: string) => Promise<void>
    moveItem: (menuId: string, direction: string) => Promise<void>
    toggleItemVisible: (menuId: string) => Promise<void>
}

export function useMenuEdit(loadMenu: (force?: boolean) => Promise<any>): MenuEditReturn {
    const editLoading = ref(false)
    const showEditModal = ref(false)
    const editForm = ref<EditForm>({
        menuId: '',
        supplier: '',
        name: '',
        price: '',
        photo: '',
    })
    const isEdit = ref(false)

    function openAdd() {
        isEdit.value = false
        editForm.value = { menuId: '', supplier: '', name: '', price: '', photo: '' }
        showEditModal.value = true
    }

    function openEdit(item: MenuItem) {
        isEdit.value = true
        editForm.value = {
            menuId: item._id,
            supplier: item.supplier,
            name: item.name,
            price: String(item.price),
            photo: item.photo || '',
        }
        showEditModal.value = true
    }

    function closeEditModal() {
        showEditModal.value = false
    }

    async function saveItem() {
        const { menuId, supplier, name, price, photo } = editForm.value
        if (!supplier || !name || price === '') {
            uni.showToast({ title: '请填写完整', icon: 'none' })
            return
        }

        editLoading.value = true
        try {
            if (isEdit.value) {
                await menuAction('updateMenuItem', {
                    menuId,
                    supplier,
                    name,
                    price: Number(price),
                    photo,
                })
            } else {
                await menuAction('addMenuItem', {
                    supplier,
                    name,
                    price: Number(price),
                    photo,
                    visible: true,
                })
            }
            showEditModal.value = false
            await loadMenu(true)
            uni.showToast({ title: isEdit.value ? '已保存' : '已添加', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        } finally {
            editLoading.value = false
        }
    }

    async function deleteItem(menuId: string) {
        const { confirm } = await uni.showModal({
            title: '确认删除',
            content: '删除后不可恢复，确定？',
        })
        if (!confirm) return

        try {
            await menuAction('deleteMenuItem', { menuId })
            await loadMenu(true)
            uni.showToast({ title: '已删除', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
    }

    async function moveItem(menuId: string, direction: string) {
        try {
            await menuAction('moveMenuItem', { menuId, direction })
            await loadMenu(true)
        } catch (e: any) {
            uni.showToast({ title: e.message || '移动失败', icon: 'none' })
        }
    }

    async function toggleItemVisible(menuId: string) {
        try {
            await menuAction('toggleVisible', { menuId })
            await loadMenu(true)
            uni.showToast({ title: '已切换', icon: 'success' })
        } catch (e: any) {
            uni.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
    }

    return {
        editLoading,
        showEditModal,
        editForm,
        isEdit,
        openAdd,
        openEdit,
        closeEditModal,
        saveItem,
        deleteItem,
        moveItem,
        toggleItemVisible,
    }
}