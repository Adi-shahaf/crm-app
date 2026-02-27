import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Simple secret to prevent unauthorized POST requests
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'secret123'

// We use the admin client here to bypass RLS since this is a server-to-server webhook
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321', // Fallback for build time
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder' // Ensure this is set in .env.local
)

type JsonRecord = Record<string, unknown>
type SupabaseResponse<T> = {
  data: T | null
  error: {
    code?: string
    message: string
  } | null
}

function hasOwn_(record: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function pickFirst_(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    if (hasOwn_(record, key)) return record[key]
  }
  return undefined
}

function toNullableText_(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function toNullableNumber_(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const parsed = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function toIsoDateTime_(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  }

  const text = String(value).trim()
  if (!text) return null

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function getMissingColumn_(message: string) {
  let match = message.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i)
  if (!match) {
    match = message.match(/Could not find the ["']?([a-zA-Z0-9_]+)["']? column/i)
  }
  return match ? match[1] : null
}

async function withMissingColumnFallback_(
  payload: Record<string, unknown>,
  operation: (currentPayload: Record<string, unknown>) => Promise<SupabaseResponse<unknown>>
) {
  const currentPayload = { ...payload }
  let response = await operation(currentPayload)
  let attemptsLeft = Object.keys(currentPayload).length

  while (response.error && attemptsLeft > 0) {
    const missingColumn = getMissingColumn_(response.error.message)
    if (!missingColumn || !hasOwn_(currentPayload, missingColumn)) break

    delete currentPayload[missingColumn]
    response = await operation(currentPayload)
    attemptsLeft -= 1
  }

  return response
}

function isUniqueViolation_(error: { code?: string; message: string } | null) {
  if (!error) return false
  return error.code === '23505' || error.message.toLowerCase().includes('duplicate key')
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (token !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as JsonRecord

    const rowId = toNullableText_(pickFirst_(body, ['rowId', 'rowID', 'external_source_id']))
    const name = toNullableText_(pickFirst_(body, ['name', 'full_name']))
    const phone = toNullableText_(pickFirst_(body, ['phone', 'phone_number']))
    const email = toNullableText_(pickFirst_(body, ['email']))
    const source = toNullableText_(pickFirst_(body, ['columnA', 'A', 'source']))
    const sheetDateTime = toIsoDateTime_(pickFirst_(body, ['dateTime', 'timestamp', 'TimeStamp', 'sheetDateTime', 'sheet_datetime']))

    const whatsappResponse = toNullableText_(pickFirst_(body, [
      'whatsappResponse',
      'whatsapp_response',
      'columnO',
      'O',
      'messageStatus',
      'message_status',
    ]))
    const employmentStatus = toNullableText_(pickFirst_(body, ['employmentStatus', 'employment_status']))
    const leadIdea = toNullableText_(pickFirst_(body, ['leadIdea', 'lead_idea']))
    const seller = toNullableText_(pickFirst_(body, ['seller']))
    const campaign = toNullableText_(pickFirst_(body, ['campaign']))
    const adName = toNullableText_(pickFirst_(body, ['ad', 'adName', 'ad_name']))
    const totalContracts = toNullableNumber_(pickFirst_(body, ['totalContracts', 'total_contracts']))
    const status = toNullableText_(pickFirst_(body, ['status']))
    const leadStatus = toNullableText_(pickFirst_(body, ['leadStatus', 'lead_status']))

    const updatePayload: Record<string, unknown> = {}
    if (name) updatePayload.full_name = name
    if (phone !== undefined) updatePayload.phone = phone
    if (email !== undefined) updatePayload.email = email
    if (source !== undefined) updatePayload.source = source
    if (sheetDateTime !== undefined) updatePayload.sheet_datetime = sheetDateTime
    if (whatsappResponse !== undefined) updatePayload.whatsapp_response = whatsappResponse
    if (employmentStatus !== undefined) updatePayload.employment_status = employmentStatus
    if (leadIdea !== undefined) updatePayload.lead_idea = leadIdea
    if (seller !== undefined) updatePayload.seller = seller
    if (campaign !== undefined) updatePayload.campaign = campaign
    if (adName !== undefined) updatePayload.ad_name = adName
    if (totalContracts !== undefined) updatePayload.total_contracts = totalContracts
    if (status !== undefined) updatePayload.status = status
    if (leadStatus !== undefined) updatePayload.lead_status = leadStatus

    if (rowId) {
      const { data: existingRows, error: existingLookupError } = await supabase
        .from('people')
        .select('id')
        .eq('external_source_id', rowId)
        .limit(1)

      if (existingLookupError) {
        console.error('Supabase Error:', existingLookupError)
        return NextResponse.json({ error: existingLookupError.message }, { status: 500 })
      }

      const existingId = existingRows?.[0]?.id
      if (existingId) {
        if (Object.keys(updatePayload).length === 0) {
          return NextResponse.json({ success: true, updated: false, reason: 'No updatable fields provided' })
        }

        const updateResponse = await withMissingColumnFallback_(updatePayload, async (payload) =>
          await supabase
            .from('people')
            .update(payload)
            .eq('id', existingId)
            .select()
        )

        if (updateResponse.error) {
          console.error('Supabase Error:', updateResponse.error)
          return NextResponse.json({ error: updateResponse.error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, updated: true, data: updateResponse.data })
      }
    }

    if (!name) {
      return NextResponse.json({ error: 'Name is required for new leads' }, { status: 400 })
    }

    // Get the ID of the 'לידים' group (new leads default group).
    const { data: newLeadsGroup } = await supabase
      .from('groups')
      .select('id')
      .eq('name', 'לידים')
      .single()

    const insertPayload: Record<string, unknown> = {
      full_name: name,
      source: source ?? 'Google Sheets',
      group_id: newLeadsGroup?.id ?? null,
      external_source_id: rowId ?? null,
    }

    if (phone !== undefined) insertPayload.phone = phone
    if (email !== undefined) insertPayload.email = email
    if (sheetDateTime !== undefined) insertPayload.sheet_datetime = sheetDateTime
    if (whatsappResponse !== undefined) insertPayload.whatsapp_response = whatsappResponse
    if (employmentStatus !== undefined) insertPayload.employment_status = employmentStatus
    if (leadIdea !== undefined) insertPayload.lead_idea = leadIdea
    if (seller !== undefined) insertPayload.seller = seller
    if (campaign !== undefined) insertPayload.campaign = campaign
    if (adName !== undefined) insertPayload.ad_name = adName
    if (totalContracts !== undefined) insertPayload.total_contracts = totalContracts
    if (status !== undefined) insertPayload.status = status
    if (leadStatus !== undefined) insertPayload.lead_status = leadStatus

    let insertResponse = await withMissingColumnFallback_(insertPayload, async (payload) =>
      await supabase
        .from('people')
        .insert(payload)
        .select()
    )

    // Race protection: if rowId collided after lookup, update by external_source_id instead of duplicating.
    if (isUniqueViolation_(insertResponse.error) && rowId) {
      const upsertUpdatePayload = { ...updatePayload }
      if (name) upsertUpdatePayload.full_name = name

      insertResponse = await withMissingColumnFallback_(upsertUpdatePayload, async (payload) =>
        await supabase
          .from('people')
          .update(payload)
          .eq('external_source_id', rowId)
          .select()
      )
    }

    if (insertResponse.error) {
      console.error('Supabase Error:', insertResponse.error)
      return NextResponse.json({ error: insertResponse.error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, inserted: true, data: insertResponse.data })

  } catch (error) {
    console.error('Webhook Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
