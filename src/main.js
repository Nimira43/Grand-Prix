import './css/main.css'
import { Editor } from './editor/editor.js'
import { TestDrive } from './race/testDrive.js'

const editor = new Editor(document.querySelector('#app'))

editor.onTestDrive = ({ track, driverIndex, mode, difficulty }) => {
  editor.active = false
  new TestDrive({
    track,
    driverIndex,
    mode,
    difficulty,
    onExit: () => {
      editor.active = true
    },
  })
}
