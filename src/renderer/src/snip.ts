const api = window.copilot
const sel = document.getElementById('sel') as HTMLDivElement
const shot = document.getElementById('shot') as HTMLImageElement
const size = document.getElementById('size') as HTMLDivElement

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
  document.body.classList.add('dragging')
  sel.classList.remove('empty')
  const left = Math.min(start.x, x)
  const top = Math.min(start.y, y)
  const w = Math.abs(x - start.x)
  const h = Math.abs(y - start.y)
  sel.style.left = `${left}px`
  sel.style.top = `${top}px`
  sel.style.width = `${w}px`
  sel.style.height = `${h}px`
  // Size readout sits under the selection, or inside it near the bottom edge of the screen.
  size.hidden = w < 8 || h < 8
  size.textContent = `${Math.round(w * devicePixelRatio)} × ${Math.round(h * devicePixelRatio)}`
  size.style.left = `${left}px`
  size.style.top = `${top + h + 26 > window.innerHeight ? top + h - 24 : top + h + 6}px`
}

function reset(): void {
  document.body.classList.remove('dragging')
  sel.className = 'empty'
  sel.removeAttribute('style')
  size.hidden = true
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
    reset()
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
