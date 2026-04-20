import { collection, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, functions as firebaseFunctions, storage } from '../firebase'

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function invoke(functionName, payload) {
  const callable = httpsCallable(firebaseFunctions, functionName)
  const response = await callable(payload)
  return response.data
}

export function createDraftId(collectionName) {
  return doc(collection(db, collectionName)).id
}

export async function uploadFiles(basePath, files) {
  const uploads = []

  for (const file of files) {
    const storagePath = `${basePath}/${Date.now()}-${sanitizeFileName(file.name)}`
    const fileRef = ref(storage, storagePath)
    const snapshot = await uploadBytes(fileRef, file)
    const url = await getDownloadURL(snapshot.ref)

    uploads.push({
      name: file.name,
      url,
      fullPath: storagePath,
      contentType: file.type,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    })
  }

  return uploads
}

export const workflowApi = {
  createUser: (payload) => invoke('createUser', payload),
  updateUserAccess: (payload) => invoke('updateUserAccess', payload),
  submitTestRequest: (payload) => invoke('submitTestRequest', payload),
  saveCosting: (payload) => invoke('saveCosting', payload),
  assignTest: (payload) => invoke('assignTest', payload),
  submitExecutionUpdate: (payload) => invoke('submitExecutionUpdate', payload),
  reviewReport: (payload) => invoke('reviewReport', payload),
  updateCommercialRecord: (payload) => invoke('updateCommercialRecord', payload),
}
