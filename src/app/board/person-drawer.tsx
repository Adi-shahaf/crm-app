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

export function PersonDrawer({
  person,
  isOpen,
  onClose
}: {
  person: PersonWithGroup | null,
  isOpen: boolean,
  onClose: () => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [newNote, setNewNote] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [newPurchase, setNewPurchase] = useState({
    serviceName: '',
    price: '',
    saleDate: getTodayDateInput(),
    paymentMethod: '',
    installmentPlan: '',
  })
  const supabase = createClient()

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

    const { data: userData } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('notes')
      .insert([{
        person_id: person.id,
        content: newNote.trim(),
        type: 'note',
        created_by: userData.user?.id
      }])
      .select()
      .single()

    if (!error && data) {
      setNotes([data, ...notes])
      setNewNote('')
    }
  }

  const handleAddPurchase = async () => {
    if (!person) return

    const serviceName = newPurchase.serviceName.trim()
    const paymentMethod = newPurchase.paymentMethod.trim()
    const price = Number(newPurchase.price)

    if (!serviceName || !paymentMethod || !newPurchase.saleDate || Number.isNaN(price)) {
      return
    }

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
      }])
      .select()
      .single()

    if (!error && data) {
      setPurchases([data, ...purchases])
      setNewPurchase({
        serviceName: '',
        price: '',
        saleDate: getTodayDateInput(),
        paymentMethod: '',
        installmentPlan: '',
      })
    }
  }

  const canCreatePurchase =
    !!newPurchase.serviceName.trim() &&
    !!newPurchase.paymentMethod &&
    !!newPurchase.saleDate &&
    newPurchase.price !== '' &&
    !Number.isNaN(Number(newPurchase.price))

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

        <Tabs defaultValue="notes" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-2 border-b">
            <TabsList className="w-full justify-start h-auto bg-transparent p-0 space-x-6">
              <TabsTrigger
                value="notes"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none px-0 pb-2 font-medium"
              >
                Notes ({notes.length})
              </TabsTrigger>
              <TabsTrigger
                value="purchases"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none px-0 pb-2 font-medium"
              >
                Purchases ({purchases.length})
              </TabsTrigger>
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
                        <span className="font-medium text-gray-700 capitalize">{note.type || 'Note'}</span>
                        <span>{new Date(note.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="purchases" className="flex-1 flex flex-col p-0 m-0 overflow-hidden">
            <div className="p-4 border-b bg-white space-y-3">
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
                <Button size="sm" onClick={handleAddPurchase} disabled={!canCreatePurchase}>
                  יצירת רכישה
                </Button>
              </div>
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
                      <div className="flex justify-between items-center gap-3">
                        <div className="font-medium text-gray-900">{p.service_id || 'Unknown Service'}</div>
                        <div className="font-semibold text-gray-900">
                          ${p.price?.toFixed(2) || '0.00'}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">תאריך מכירה: {p.sale_date ? new Date(p.sale_date).toLocaleDateString() : '-'}</div>
                      <div className="text-sm text-gray-500">אופן תשלום: {p.payment_method || '-'}</div>
                      <div className="text-sm text-gray-500">הסדר תשלומים: {p.installment_plan || '-'}</div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
