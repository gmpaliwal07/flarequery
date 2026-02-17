import { Firestore } from "firebase-admin/firestore";
import { FirestoreAdapter, DocumentSnapshot } from '@flarequery/core';

const FIRESTORE_GETALL_LIMIT = 300

export function createFirestoreAdapter(db: Firestore): FirestoreAdapter {
    return {
        async getOne(collection, id, fieldMask) {
            const ref = db.collection(collection).doc(id)

            const snapshot = await ref.get()

            return adaptSnapshot(snapshot, fieldMask)
        },

        async getMany(collection, ids, fieldMask) {
            if (ids.length === 0) return []

            const chunks = chunkArray(ids, FIRESTORE_GETALL_LIMIT)

            const chunkResults = await Promise.all(
                chunks.map((chunk) => {
                    const refs = chunk.map((id) => db.collection(collection).doc(id))
            
                    return db.getAll(...refs, { fieldMask })
                })
            )

            return chunkResults.flat().map((snap) => adaptSnapshot(snap, fieldMask))
        },
    }
}
function adaptSnapshot(
    snap: FirebaseFirestore.DocumentSnapshot,
    fieldMask: string[]
): DocumentSnapshot {
    return {
        id: snap.id,
        exists: snap.exists,
        data() {
            if (!snap.exists) return undefined

            const raw = snap.data() ?? {}
            const masked: Record<string, unknown> = {}

            for (const field of fieldMask) {
                if (field in raw) {
                    masked[field] = raw[field]
                }
            }

            return masked
        },
    }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size))
    }
    return chunks
}