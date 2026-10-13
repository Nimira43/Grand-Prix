import { Track } from './track.js'
import { EXAMPLE_TRACK } from '../data/exampleTrack.js'

const LIBRARY_KEY = 'grand-prix.tracks'
const DRAFT_KEY = 'grand-prix.editor.draft'

function read(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function library() {
  let lib = read(LIBRARY_KEY)
  if (!lib || typeof lib !== 'object') {
    lib = {
      [EXAMPLE_TRACK.name]: {
        ...EXAMPLE_TRACK,
        valid: true,
        savedAt: Date.now(),
      },
    }
    write(LIBRARY_KEY, lib)
  }
  return lib
}

export function listTracks() {
  return Object.values(library())
    .map(({ name, valid, savedAt }) => ({
      name,
      valid: !!valid,
      savedAt: savedAt ?? 0,
    }))
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function trackExists(name) {
  return Object.prototype.hasOwnProperty.call(library(), name)
}

export function saveTrack(track, valid) {
  const lib = library()
  lib[track.name] = { ...track.toJSON(), valid: !!valid, savedAt: Date.now() }
  return write(LIBRARY_KEY, lib)
}

export function loadTrack(name) {
  const data = library()[name]
  return data ? Track.fromJSON(data) : null
}

export function deleteTrack(name) {
  const lib = library()
  delete lib[name]
  return write(LIBRARY_KEY, lib)
}

export function saveDraft(track) {
  write(DRAFT_KEY, track.toJSON())
}

export function loadDraft() {
  const data = read(DRAFT_KEY)
  if (!data) return null
  try {
    return Track.fromJSON(data)
  } catch {
    return null
  }
}

export function exampleTrack() {
  return Track.fromJSON(EXAMPLE_TRACK)
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'circuit'

export function exportTrack(track) {
  const blob = new Blob([JSON.stringify(track.toJSON(), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug(track.name)}.gptrack.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function importTrackFile(file) {
  const text = await file.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON")
  }
  return Track.fromJSON(data)
}
