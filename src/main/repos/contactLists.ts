import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { contactLists } from '../db/schema'
import type { ContactList } from '@shared/types'

export function listContactLists(): ContactList[] {
  return getDb().select().from(contactLists).orderBy(desc(contactLists.createdAt)).all()
}

export function createContactList(name: string): ContactList {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Nome da base nao pode ser vazio.')
  const row: ContactList = { id: randomUUID(), name: trimmed, createdAt: Date.now() }
  getDb().insert(contactLists).values(row).run()
  scheduleSave()
  return row
}

export function removeContactList(id: string): void {
  getDb().delete(contactLists).where(eq(contactLists.id, id)).run()
  scheduleSave()
}
