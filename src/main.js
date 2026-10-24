import './css/main.css'
import { Editor } from './editor/editor.js'
import { TestDrive } from './race/testDrive.js'

const editor = new Editor(document.querySelector('#app'))

editor.onTestDrive = ({ track, driverIndex, mode, difficulty, assists }) => {
  editor.active = false
  const race = new TestDrive({
    track,
    driverIndex,
    mode,
    difficulty,
    assists,
    onExit: () => {
      editor.active = true
    },
  })
  race.onAssistsChange = (a) => editor.setAssists(a) 
}
