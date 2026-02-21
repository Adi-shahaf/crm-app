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
import { createClient } from '@/utils/supabase/client'
import { useState, useEffect } from 'react'

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
  const supabase = createClient()

  useEffect(() => {
    if (person && isOpen) {
      loadData()
    }
  }, [person, isOpen])

  const loadData = async () => {
    if (!person) return
    setIsLoading(true)
    
    const [notesRes, purchasesRes] = await Promise.all([
      supabase.from('notes').select('*').eq('person_id', person.id).order('created_at', { ascending: false }),
      supabase.from('purchases').select('*').eq('person_id', person.id).order('created_at', { ascending: false })
    ])

    if (notesRes.data) setNotes(notesRes.data)
    if (purchasesRes.data) setPurchases(purchasesRes.data)
    
    setIsLoading(false)
  }

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
             <ScrollArea className="flex-1 p-6">
                {/* Simplified Purchases list for MVP */}
                {isLoading ? (
                  <p className="text-sm text-gray-500 text-center py-4">Loading purchases...</p>
                ) : purchases.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">No purchases recorded yet.</p>
                ) : (
                  <div className="space-y-4">
                    {purchases.map(p => (
                      <div key={p.id} className="p-4 border rounded-lg flex justify-between items-center bg-white shadow-sm">
                        <div>
                          <div className="font-medium text-gray-900">{p.service_id || 'Unknown Service'}</div>
                          <div className="text-sm text-gray-500">Status: <span className="capitalize">{p.payment_status}</span></div>
                        </div>
                        <div className="font-semibold text-gray-900">
                           ${p.price?.toFixed(2) || '0.00'}
                        </div>
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
