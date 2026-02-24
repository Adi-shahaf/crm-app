import { PersonWithGroup, Note, Purchase } from '@/types/database'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2 } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { useState, useEffect } from 'react'

const PAYMENT_METHOD_OPTIONS = [
  'מזומן',
  'כרטיס אשראי',
  'העברה בנקאית',
  'ביט',
  'פייבוקס',
  "צ'ק",
  'אחר',
]

const getTodayDateInput = () => new Date().toISOString().split('T')[0]

const getSupabaseErrorMessage = (error: unknown) => {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object') {
    const maybeError = error as {
      message?: string
      details?: string
      hint?: string
      code?: string
    }
    if (maybeError.message) return maybeError.message
    const details = [maybeError.code, maybeError.details, maybeError.hint]
      .filter(Boolean)
      .join(' | ')
    if (details) return details
    try {
      return JSON.stringify(error)
    } catch {
      return 'Unexpected error object'
    }
  }
  return 'Unexpected error type'
}

export function PersonDrawer({
  person,
  isOpen,
  onClose,
  initialTab = 'notes',
  canAccessSalesTab = true,
  onPurchaseCreated,
  onPurchaseUpdated,
  onPurchaseDeleted,
  onNotesChanged
}: {
  person: PersonWithGroup | null,
  isOpen: boolean,
  onClose: () => void,
  initialTab?: 'notes' | 'purchases',
  canAccessSalesTab?: boolean,
  onPurchaseCreated?: (personId: string, price: number) => void,
  onPurchaseUpdated?: (personId: string, previousPrice: number, nextPrice: number) => void,
  onPurchaseDeleted?: (personId: string, price: number) => void,
  onNotesChanged?: (personId: string, delta: number) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [newNote, setNewNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [newPurchase, setNewPurchase] = useState({
    serviceName: '',
    price: '',
    saleDate: getTodayDateInput(),
    paymentMethod: '',
    installmentPlan: '',
  })
  const [isPurchaseFormOpen, setIsPurchaseFormOpen] = useState(false)
  const [isCreatingPurchase, setIsCreatingPurchase] = useState(false)
  const [purchaseError, setPurchaseError] = useState('')
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null)
  const [editingPurchase, setEditingPurchase] = useState({
    serviceName: '',
    price: '',
    saleDate: getTodayDateInput(),
    paymentMethod: '',
    installmentPlan: '',
  })
  const [isUpdatingPurchaseId, setIsUpdatingPurchaseId] = useState<string | null>(null)
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(null)
  const [editPurchaseError, setEditPurchaseError] = useState('')
  const supabase = createClient()

  const getNoteAuthorName = (note: Note) => {
    if (note.created_by_name?.trim()) return note.created_by_name.trim()
    if (note.created_by && currentUserId && note.created_by === currentUserId && currentUserEmail) {
      return currentUserEmail
    }
    return 'Unknown email'
  }

  useEffect(() => {
    const loadCurrentUser = async () => {
      const { data } = await supabase.auth.getUser()
      setCurrentUserId(data.user?.id ?? null)
      setCurrentUserEmail(data.user?.email ?? null)
    }

    loadCurrentUser()
  }, [supabase])

  useEffect(() => {
    if (!person || !isOpen) return

    const loadData = async () => {
      setIsLoading(true)

      const [notesRes, purchasesRes] = await Promise.all([
        supabase.from('notes').select('*').eq('person_id', person.id).order('created_at', { ascending: false }),
        supabase.from('purchases').select('*').eq('person_id', person.id).order('created_at', { ascending: false })
      ])

      if (notesRes.data) setNotes(notesRes.data)
      if (purchasesRes.data) setPurchases(purchasesRes.data)

      setIsLoading(false)
    }

    loadData()
  }, [person, isOpen, supabase])

  const handleAddNote = async () => {
    if (!person || !newNote.trim()) return

    setNoteError('')
    const { data: userData } = await supabase.auth.getUser()
    setCurrentUserId(userData.user?.id ?? null)
    setCurrentUserEmail(userData.user?.email ?? null)
    const createdByName =
      userData.user?.email ||
      userData.user?.user_metadata?.email ||
      null

    let { data, error } = await supabase
      .from('notes')
      .insert([{
        person_id: person.id,
        content: newNote.trim(),
        type: 'note',
        created_by: userData.user?.id,
        created_by_name: createdByName
      }])
      .select()
      .single()

    if (error) {
      const message = getSupabaseErrorMessage(error)
      const isMissingCreatedByNameColumn =
        message.includes('created_by_name') &&
        (message.includes('does not exist') || message.includes('column'))

      if (isMissingCreatedByNameColumn) {
        const fallbackResult = await supabase
          .from('notes')
          .insert([{
            person_id: person.id,
            content: newNote.trim(),
            type: 'note',
            created_by: userData.user?.id,
          }])
          .select()
          .single()

        data = fallbackResult.data
        error = fallbackResult.error
      }
    }

    if (!error && data) {
      setNotes([data, ...notes])
      setNewNote('')
      setNoteError('')
      onNotesChanged?.(person.id, 1)
      return
    }

    setNoteError(`Could not save update: ${getSupabaseErrorMessage(error)}`)
  }

  const handleDeleteNote = async (noteId: string) => {
    setNoteError('')
    setDeletingNoteId(noteId)

    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', noteId)

    if (error) {
      setNoteError(`Could not delete update: ${getSupabaseErrorMessage(error)}`)
      setDeletingNoteId(null)
      return
    }

    setNotes((prev) => prev.filter((note) => note.id !== noteId))
    if (person) {
      onNotesChanged?.(person.id, -1)
    }
    setDeletingNoteId(null)
  }

  const handleAddPurchase = async () => {
    if (!person) return

    const serviceName = newPurchase.serviceName.trim()
    const paymentMethod = newPurchase.paymentMethod.trim()
    const normalizedPrice = newPurchase.price.replace(',', '.').trim()
    const price = Number(normalizedPrice)

    if (!serviceName || !paymentMethod || !newPurchase.saleDate || Number.isNaN(price)) {
      setPurchaseError('נא למלא את כל השדות הנדרשים בצורה תקינה.')
      return
    }

    setPurchaseError('')
    setIsCreatingPurchase(true)

    const { data, error } = await supabase
      .from('purchases')
      .insert([{
        person_id: person.id,
        service_id: serviceName,
        price,
        payment_method: paymentMethod,
        installment_plan: newPurchase.installmentPlan.trim() || null,
        sale_date: newPurchase.saleDate,
        payment_status: 'pending',
        project_stage: 'future',
      }])
      .select()
      .single()

    if (error) {
      const message = getSupabaseErrorMessage(error)
      if (
        message.includes('sale_date') ||
        message.includes('installment_plan') ||
        message.includes('project_stage')
      ) {
        setPurchaseError('השינויים במסד הנתונים לא עודכנו עדיין. צריך להריץ את המיגרציה החדשה.')
      } else {
        setPurchaseError(`שמירת רכישה נכשלה: ${message}`)
      }
      setIsCreatingPurchase(false)
      return
    }

    if (data) {
      setPurchases([data, ...purchases])
      onPurchaseCreated?.(person.id, price)
      setNewPurchase({
        serviceName: '',
        price: '',
        saleDate: getTodayDateInput(),
        paymentMethod: '',
        installmentPlan: '',
      })
      setPurchaseError('')
      setIsPurchaseFormOpen(false)
    }

    setIsCreatingPurchase(false)
  }

  const startEditingPurchase = (purchase: Purchase) => {
    setEditingPurchaseId(purchase.id)
    setEditPurchaseError('')
    setEditingPurchase({
      serviceName: purchase.service_id ?? '',
      price: purchase.price != null ? String(purchase.price) : '',
      saleDate: purchase.sale_date ? purchase.sale_date.split('T')[0] : getTodayDateInput(),
      paymentMethod: purchase.payment_method ?? '',
      installmentPlan: purchase.installment_plan ?? '',
    })
  }

  const handleCancelEditPurchase = () => {
    setEditingPurchaseId(null)
    setIsUpdatingPurchaseId(null)
    setEditPurchaseError('')
  }

  const handleSavePurchaseEdit = async (purchase: Purchase) => {
    if (!person) return

    const serviceName = editingPurchase.serviceName.trim()
    const paymentMethod = editingPurchase.paymentMethod.trim()
    const normalizedPrice = editingPurchase.price.replace(',', '.').trim()
    const price = Number(normalizedPrice)

    if (!serviceName || !paymentMethod || !editingPurchase.saleDate || Number.isNaN(price)) {
      setEditPurchaseError('נא למלא את כל השדות הנדרשים בצורה תקינה.')
      return
    }

    setEditPurchaseError('')
    setIsUpdatingPurchaseId(purchase.id)

    const { data, error } = await supabase
      .from('purchases')
      .update({
        service_id: serviceName,
        price,
        sale_date: editingPurchase.saleDate,
        payment_method: paymentMethod,
        installment_plan: editingPurchase.installmentPlan.trim() || null,
      })
      .eq('id', purchase.id)
      .select()
      .single()

    if (error) {
      setEditPurchaseError(`עדכון רכישה נכשל: ${getSupabaseErrorMessage(error)}`)
      setIsUpdatingPurchaseId(null)
      return
    }

    if (data) {
      setPurchases((prev) => prev.map((existing) => (existing.id === purchase.id ? data : existing)))
      const previousPrice = typeof purchase.price === 'number' ? purchase.price : Number(purchase.price || 0)
      onPurchaseUpdated?.(
        person.id,
        Number.isNaN(previousPrice) ? 0 : previousPrice,
        price
      )
    }

    setEditingPurchaseId(null)
    setIsUpdatingPurchaseId(null)
    setEditPurchaseError('')
  }

  const handleDeletePurchase = async (purchase: Purchase) => {
    if (!person) return

    setEditPurchaseError('')
    setDeletingPurchaseId(purchase.id)

    const { error } = await supabase
      .from('purchases')
      .delete()
      .eq('id', purchase.id)

    if (error) {
      setEditPurchaseError(`מחיקת רכישה נכשלה: ${getSupabaseErrorMessage(error)}`)
      setDeletingPurchaseId(null)
      return
    }

    setPurchases((prev) => prev.filter((existing) => existing.id !== purchase.id))
    const deletedPrice = typeof purchase.price === 'number' ? purchase.price : Number(purchase.price || 0)
    onPurchaseDeleted?.(person.id, Number.isNaN(deletedPrice) ? 0 : deletedPrice)
    setDeletingPurchaseId(null)
  }

  const canCreatePurchase =
    !!newPurchase.serviceName.trim() &&
    !!newPurchase.paymentMethod &&
    !!newPurchase.saleDate &&
    newPurchase.price !== '' &&
    !Number.isNaN(Number(newPurchase.price.replace(',', '.').trim()))
  const safeInitialTab = !canAccessSalesTab && initialTab === 'purchases' ? 'notes' : initialTab

  if (!person) return null

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] sm:max-w-none flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b bg-gray-50/50 space-y-1">
          <SheetTitle className="text-xl">{person.full_name}</SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <span>{person.email || 'No email'}</span>
            <span>•</span>
            <span>{person.phone || 'No phone'}</span>
          </SheetDescription>
        </SheetHeader>

        <Tabs
          key={`${person.id}-${safeInitialTab}`}
          defaultValue={safeInitialTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="px-6 pt-2 border-b">
            <TabsList className="w-full justify-start h-auto bg-transparent p-0 space-x-6">
              <TabsTrigger
                value="notes"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none px-0 pb-2 font-medium"
              >
                Notes ({notes.length})
              </TabsTrigger>
              {canAccessSalesTab ? (
                <TabsTrigger
                  value="purchases"
                  className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none px-0 pb-2 font-medium"
                >
                  Purchases ({purchases.length})
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>

          <TabsContent value="notes" className="flex-1 flex flex-col p-0 m-0 overflow-hidden">
            <div className="p-4 border-b bg-white">
              <Textarea
                placeholder="Write an update..."
                className="min-h-[100px] resize-none mb-2 focus-visible:ring-1"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleAddNote} disabled={!newNote.trim()}>
                  Update
                </Button>
              </div>
              {noteError ? (
                <p className="text-sm text-red-600 mt-2">{noteError}</p>
              ) : null}
            </div>

            <ScrollArea className="flex-1 p-4 bg-gray-50">
              <div className="space-y-4">
                {isLoading ? (
                  <p className="text-sm text-gray-500 text-center py-4">Loading updates...</p>
                ) : notes.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">No updates yet. Write one above!</p>
                ) : (
                  notes.map(note => (
                    <div key={note.id} className="bg-white p-4 rounded-lg border shadow-sm space-y-2">
                      <div className="flex justify-between items-start text-xs text-gray-500">
                        <div className="space-y-0.5">
                          <span className="block font-medium text-gray-700 capitalize">{note.type || 'Note'}</span>
                          <span className="block text-gray-500">By {getNoteAuthorName(note)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{new Date(note.created_at).toLocaleString()}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600"
                            onClick={() => handleDeleteNote(note.id)}
                            disabled={deletingNoteId === note.id}
                            aria-label="Delete note"
                            title="Delete note"
                          >
                            <Trash2 className={`h-3.5 w-3.5 ${deletingNoteId === note.id ? 'animate-pulse' : ''}`} />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {canAccessSalesTab ? (
            <TabsContent value="purchases" className="flex-1 flex flex-col p-0 m-0 overflow-hidden">
              <div className="p-4 border-b bg-white">
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant={isPurchaseFormOpen ? "outline" : "default"}
                    onClick={() => {
                      setPurchaseError('')
                      setIsPurchaseFormOpen((prev) => !prev)
                    }}
                  >
                    {isPurchaseFormOpen ? 'סגור' : 'הוספת רכישה'}
                  </Button>
                </div>

                {isPurchaseFormOpen ? (
                  <div className="mt-3 space-y-3">
                    <Input
                      placeholder="שם השירות"
                      value={newPurchase.serviceName}
                      onChange={(e) => setNewPurchase((prev) => ({ ...prev, serviceName: e.target.value }))}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="מחיר"
                      value={newPurchase.price}
                      onChange={(e) => setNewPurchase((prev) => ({ ...prev, price: e.target.value }))}
                    />
                    <Input
                      type="date"
                      value={newPurchase.saleDate}
                      onChange={(e) => setNewPurchase((prev) => ({ ...prev, saleDate: e.target.value }))}
                    />
                    <Select
                      value={newPurchase.paymentMethod}
                      onValueChange={(value) => setNewPurchase((prev) => ({ ...prev, paymentMethod: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="אופן התשלום" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHOD_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="הסדר תשלומים (טקסט חופשי)"
                      value={newPurchase.installmentPlan}
                      onChange={(e) => setNewPurchase((prev) => ({ ...prev, installmentPlan: e.target.value }))}
                    />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleAddPurchase} disabled={!canCreatePurchase || isCreatingPurchase}>
                        יצירת רכישה
                      </Button>
                    </div>
                    {purchaseError ? (
                      <p className="text-sm text-red-600">{purchaseError}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <ScrollArea className="flex-1 p-6 bg-gray-50">
                {isLoading ? (
                  <p className="text-sm text-gray-500 text-center py-4">Loading purchases...</p>
                ) : purchases.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">No purchases recorded yet.</p>
                ) : (
                  <div className="space-y-4">
                    {purchases.map((p) => (
                      <div key={p.id} className="p-4 border rounded-lg bg-white shadow-sm space-y-1">
                        {editingPurchaseId === p.id ? (
                          <div className="space-y-3">
                            <Input
                              placeholder="שם השירות"
                              value={editingPurchase.serviceName}
                              onChange={(e) => setEditingPurchase((prev) => ({ ...prev, serviceName: e.target.value }))}
                            />
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="מחיר"
                              value={editingPurchase.price}
                              onChange={(e) => setEditingPurchase((prev) => ({ ...prev, price: e.target.value }))}
                            />
                            <Input
                              type="date"
                              value={editingPurchase.saleDate}
                              onChange={(e) => setEditingPurchase((prev) => ({ ...prev, saleDate: e.target.value }))}
                            />
                            <Select
                              value={editingPurchase.paymentMethod}
                              onValueChange={(value) => setEditingPurchase((prev) => ({ ...prev, paymentMethod: value }))}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="אופן התשלום" />
                              </SelectTrigger>
                              <SelectContent>
                                {PAYMENT_METHOD_OPTIONS.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              placeholder="הסדר תשלומים (טקסט חופשי)"
                              value={editingPurchase.installmentPlan}
                              onChange={(e) => setEditingPurchase((prev) => ({ ...prev, installmentPlan: e.target.value }))}
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={handleCancelEditPurchase}
                                disabled={isUpdatingPurchaseId === p.id}
                              >
                                ביטול
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleSavePurchaseEdit(p)}
                                disabled={isUpdatingPurchaseId === p.id}
                              >
                                {isUpdatingPurchaseId === p.id ? 'שומר...' : 'שמירה'}
                              </Button>
                            </div>
                            {editPurchaseError ? (
                              <p className="text-sm text-red-600">{editPurchaseError}</p>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-between items-center gap-3">
                              <div className="font-medium text-gray-900">{p.service_id || 'Unknown Service'}</div>
                              <div className="font-semibold text-gray-900">
                                ₪{p.price?.toFixed(2) || '0.00'}
                              </div>
                            </div>
                            <div className="text-sm text-gray-500">תאריך מכירה: {p.sale_date ? new Date(p.sale_date).toLocaleDateString() : '-'}</div>
                            <div className="text-sm text-gray-500">אופן תשלום: {p.payment_method || '-'}</div>
                            <div className="text-sm text-gray-500">הסדר תשלומים: {p.installment_plan || '-'}</div>
                            <div className="flex justify-end gap-2 pt-2">
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                onClick={() => handleDeletePurchase(p)}
                                disabled={deletingPurchaseId === p.id}
                                aria-label="Delete service"
                                title="Delete service"
                              >
                                <Trash2 className={`h-3.5 w-3.5 ${deletingPurchaseId === p.id ? 'animate-pulse' : ''}`} />
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => startEditingPurchase(p)}>
                                עריכה
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          ) : null}
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
