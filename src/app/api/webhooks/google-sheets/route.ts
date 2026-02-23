import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Simple secret to prevent unauthorized POST requests
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'secret123'

// We use the admin client here to bypass RLS since this is a server-to-server webhook
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321', // Fallback for build time
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder' // Ensure this is set in .env.local
)

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (token !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    
    // Default column mapping (can be adjusted based on the Apps Script payload)
    const { 
      name, 
      phone, 
      email, 
      source = 'Google Sheets', 
      dateTime,
      timestamp,
      TimeStamp,
      rowId // Unique identifier from sheet to prevent duplicates
    } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Get the ID of the 'New Leads' group (sort_order = 10)
    const { data: newLeadsGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('name', 'New Leads')
      .single()

    const rawDateTime = dateTime ?? timestamp ?? TimeStamp
    const parsedSheetDateTime = rawDateTime ? new Date(rawDateTime) : null
    const sheetDateTime = parsedSheetDateTime && !Number.isNaN(parsedSheetDateTime.getTime())
      ? parsedSheetDateTime.toISOString()
      : null

    const basePayload = {
      full_name: name,
      phone,
      email,
      source,
      group_id: newLeadsGroup?.id,
      external_source_id: rowId,
    }

    const upsertOptions = { onConflict: 'external_source_id' as const }
    let upsertResponse = await supabase
      .from('people')
      .upsert(
        {
          ...basePayload,
          sheet_datetime: sheetDateTime,
        },
        upsertOptions
      )
      .select()

    // Backward compatibility: if migration for sheet_datetime has not been applied yet.
    if (upsertResponse.error?.message?.includes('sheet_datetime')) {
      upsertResponse = await supabase
        .from('people')
        .upsert(basePayload, upsertOptions)
        .select()
    }

    if (upsertResponse.error) {
      console.error('Supabase Error:', upsertResponse.error)
      return NextResponse.json({ error: upsertResponse.error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: upsertResponse.data })

  } catch (error) {
    console.error('Webhook Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
