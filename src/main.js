import './css/main.css'
import './css/menu.css'
import { Editor } from './editor/editor.js'
import { TestDrive } from './race/testDrive.js'
import { Menus } from './menu/menus.js'
import { useField } from './data/fields.js'

const app = document.querySelector('#app')
let editor = null

const game = {
  startRace({ onAssistsChange, onExit, field = 'grid', ...options }) {
    menus.hide()
    useField(field)
    const race = new TestDrive({ ...options, exitLabel: 'menu', onExit })
    race.onAssistsChange = onAssistsChange ?? null
    if (import.meta.env.DEV) window.__testDrive = race
  },

  openEditor({ fresh = false } = {}) {
    menus.hide()
    useField('grid')
    if (!editor) {
      const box = document.createElement('div')
      box.className = 'gp-editor-box'
      app.appendChild(box)
      editor = new Editor(box)
      editor.onMenu = () => {
        editor.setVisible(false)
        menus.show('title', 'editor')
      }

      editor.onTestDrive = ({
        track,
        driverIndex,
        mode,
        difficulty,
        assists,
        qualifying,
      }) => {
        editor.active = false
        const race = new TestDrive({
          track,
          driverIndex,
          mode,
          difficulty,
          assists,
          qualifying,
          onExit: () => {
            editor.active = true
          },
        })
        race.onAssistsChange = (a) => editor.setAssists(a)
        if (import.meta.env.DEV) window.__testDrive = race
      }
    }
    editor.setVisible(true)
    if (fresh) editor.freshTrack()
  },
}

const menus = new Menus(app, game)
menus.show('title')
if (import.meta.env.DEV) window.__menus = menus
