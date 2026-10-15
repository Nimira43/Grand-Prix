import './css/main.css'
import { Editor } from './editor/editor.js'
import { TestDrive } from './race/testDrive.js'


const editor = new Editor(document.querySelector('#app'))

editor.onTestDrive = ({ track, driverIndex }) => {
  editor.active = false
  new TestDrive({
    track,
    driverIndex,
    onExit: () => {
      editor.active = true
    },
  })
}
