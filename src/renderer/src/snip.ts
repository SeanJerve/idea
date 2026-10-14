const api = window.copilot
const sel = document.getElementById('sel') as HTMLDivElement
const shot = document.getElementById('shot') as HTMLImageElement

let start: { x: number; y: number } | null = null
let done = false

function view(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

function finish(selection: { x: number; y: number; width: number; height: number } | null): void {
  if (done) return
  done = true
  void api.finishSnip(selection, view())
}

function draw(x: number, y: number): void {
  if (!start) return
  sel.classList.remove('empty')
  sel.style.left = `${Math.min(start.x, x)}px`
  sel.style.top = `${Math.min(start.y, y)}px`
  sel.style.width = `${Math.abs(x - start.x)}px`
  sel.style.height = `${Math.abs(y - start.y)}px`
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  start = { x: e.clientX, y: e.clientY }
  draw(e.clientX, e.clientY)
})
window.addEventListener('mousemove', (e) => draw(e.clientX, e.clientY))
window.addEventListener('mouseup', (e) => {
  if (!start) return
  const selection = { x: start.x, y: start.y, width: e.clientX - start.x, height: e.clientY - start.y }
  start = null
  // A plain click (no drag) is ignored so a stray click doesn't send a tiny image.
  if (Math.abs(selection.width) < 8 || Math.abs(selection.height) < 8) {
    sel.className = 'empty'
    sel.removeAttribute('style')
    return
  }
  finish(selection)
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') finish(null)
})
// Right-click cancels too, like most snipping tools.
window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  finish(null)
})

void api.snipImage().then((url) => {
  if (url) shot.src = url
  else finish(null)
})
