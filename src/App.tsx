import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Glasses, Languages, LampDesk, Moon, Minus, Plus, Upload, Volume2, ChevronLeft, ChevronRight, BookOpen, Sun, Contrast, Type, X } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import './App.css'

type ReaderMode = 'paper' | 'night' | 'lamp' | 'contrast'
type BookPage = { heading?: string; text: string }

const samplePages: BookPage[] = [
  {
    heading: 'A quieter way to read',
    text: 'Reading asks for a particular kind of attention. It is a small doorway out of the noise of the day, and into a world that moves at the pace of a sentence.\n\nA good reading space does not ask to be noticed. The light is gentle. The page has room to breathe. The words sit still long enough for the mind to wander, then find its way back.',
  },
  {
    heading: 'Make room for the words',
    text: 'There is no single correct way to read. Some people like a wide margin and a generous line. Others need larger type, warmer light, or a screen that turns down its brightness.\n\nThe best setting is the one that lets you stay with the story. Adjust it until the page feels like somewhere you can settle in.',
  },
  {
    heading: 'Find your own rhythm',
    text: 'One page at a time is enough. A chapter can wait. A book does not mind if you pause, reread a passage, or pick it up tomorrow.\n\nLet the words arrive without hurry. When you are ready, the next page will be here.',
  },
]

const languages = [
  ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['zh-CN', 'Chinese'],
]

function paginateText(text: string): BookPage[] {
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  const pages: BookPage[] = []
  let current: string[] = []
  let length = 0

  for (const paragraph of paragraphs) {
    if (current.length && length + paragraph.length > 1800) {
      pages.push({ text: current.join('\n\n') })
      current = []
      length = 0
    }
    current.push(paragraph)
    length += paragraph.length
  }
  if (current.length) pages.push({ text: current.join('\n\n') })
  return pages.length ? pages : [{ text: 'This document does not contain readable text.' }]
}

function PdfPage({ document, pageNumber }: { document: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderError, setRenderError] = useState('')

  useEffect(() => {
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined

    void document.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      const viewport = page.getViewport({ scale: 1.35 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      return renderTask.promise
    }).catch(() => {
      if (!cancelled) setRenderError('This PDF page could not be rendered. Try Text view or reopen the document.')
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber])

  return <>{renderError && <p role="alert">{renderError}</p>}<canvas ref={canvasRef} className="pdf-page" aria-label={`PDF page ${pageNumber}`} /></>
}

function App() {
  const [pages, setPages] = useState<BookPage[]>(samplePages)
  const [pageNumber, setPageNumber] = useState(0)
  const [fileName, setFileName] = useState('The little book of reading')
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [mode, setMode] = useState<ReaderMode>('paper')
  const [fontSize, setFontSize] = useState(19)
  const [fontStyle, setFontStyle] = useState<'serif' | 'sans'>('serif')
  const [targetLanguage, setTargetLanguage] = useState('es')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [flipping, setFlipping] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [pdfView, setPdfView] = useState<'text' | 'original'>('text')
  const [zoom, setZoom] = useState(100)
  const [lineSpacing, setLineSpacing] = useState(1.8)
  const [speechRate, setSpeechRate] = useState(1)
  const [paused, setPaused] = useState(false)
  const [jumpPage, setJumpPage] = useState('1')
  const [bookmarks, setBookmarks] = useState<number[]>([])
  const [direction, setDirection] = useState('forward')
  const flipTimer = useRef<number | undefined>(undefined)
  const loadId = useRef(0)
  const speechId = useRef(0)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const stopSpeech = useCallback(() => {
    speechId.current++
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    utteranceRef.current = null
    setSpeaking(false)
    setPaused(false)
  }, [])
  useEffect(() => () => { void pdfDocument?.loadingTask.destroy() }, [pdfDocument])
  useEffect(() => () => {
    window.clearTimeout(flipTimer.current)
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentPage = pages[pageNumber] ?? { text: '' }
  const progress = Math.round(((pageNumber + 1) / pages.length) * 100)

  async function openFile(file?: File) {
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension !== 'pdf' && extension !== 'docx') {
      setError('Choose a PDF or DOCX file to start reading.')
      return
    }

    const requestId = ++loadId.current
    stopSpeech()
    window.clearTimeout(flipTimer.current)
    setFlipping(false)
    setIsLoading(true)
    setError('')
    try {
      const data = await file.arrayBuffer()
      if (extension === 'pdf') {
        const pdfjs = await import('pdfjs-dist')
        const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default
        const document = await pdfjs.getDocument({ data }).promise
        const pdfPages: BookPage[] = []
        try {
        for (let index = 0; index < document.numPages; index++) {
          if (requestId !== loadId.current) { await document.loadingTask.destroy(); return }
          const page = await document.getPage(index + 1)
          const content = await page.getTextContent()
          pdfPages.push({ text: content.items.map((item) => 'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '').join('').trim() })
        }
        } catch (cause) { await document.loadingTask.destroy(); throw cause }
        if (requestId !== loadId.current) { await document.loadingTask.destroy(); return }
        setPdfDocument(document)
        setPages(pdfPages)
        setPdfView(pdfPages[0]?.text ? 'text' : 'original')
      } else {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ arrayBuffer: data })
        if (requestId !== loadId.current) return
        setPdfDocument(null)
        setPages(paginateText(result.value))
      }
      setPageNumber(0)
      setJumpPage('1')
      setBookmarks([])
      setZoom(100)
      setFileName(file.name.replace(/\.(pdf|docx)$/i, ''))
    } catch {
      if (requestId !== loadId.current) return
      setError('This file could not be opened. It may be damaged or password protected.')
    } finally {
      if (requestId === loadId.current) setIsLoading(false)
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void openFile(event.target.files?.[0])
    event.target.value = ''
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    void openFile(event.dataTransfer.files[0])
  }

  const turnPage = useCallback((nextPage: number) => {
    if (nextPage < 0 || nextPage >= pages.length || nextPage === pageNumber || flipping || isLoading) return
    stopSpeech()
    setDirection(nextPage > pageNumber ? 'forward' : 'backward')
    setFlipping(true)
    setPageNumber(nextPage)
    setJumpPage(String(nextPage + 1))
    flipTimer.current = window.setTimeout(() => {
      setFlipping(false)
    }, 650)
  }, [pages.length, pageNumber, flipping, isLoading, stopSpeech])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      const direction = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0
      const nextPage = pageNumber + direction
      if (direction && !flipping && !isLoading && nextPage >= 0 && nextPage < pages.length) {
        event.preventDefault()
        turnPage(nextPage)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pageNumber, pages.length, flipping, isLoading, turnPage])

  function translatePage() {
    const text = currentPage.text || currentPage.heading || ''
    const url = `https://translate.google.com/?sl=auto&tl=${targetLanguage}&text=${encodeURIComponent(text)}&op=translate`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function readAloud() {
    if (!('speechSynthesis' in window)) {
      setError('Read aloud is not available in this browser.')
      return
    }
    if (speaking) {
      stopSpeech()
      return
    }
    stopSpeech()
    const text = [currentPage.heading, currentPage.text].filter(Boolean).join('. ')
    if (!text.trim()) { setError('This page needs OCR before it can be read aloud.'); return }
    const chunks = text.match(/.{1,220}(?:\s|$)|\S{1,220}/gs) ?? [text]
    const id = speechId.current
    let index = 0
    function speakNext() {
      if (id !== speechId.current) return
      if (index >= chunks.length) { setSpeaking(false); setPaused(false); utteranceRef.current = null; return }
      const utterance = new SpeechSynthesisUtterance(chunks[index++])
      utterance.rate = speechRate
      utterance.onend = speakNext
      utterance.onerror = () => { if (id === speechId.current) { stopSpeech(); setError('Playback stopped. Try reading this page again.') } }
      utteranceRef.current = utterance
      window.speechSynthesis.speak(utterance)
    }
    setSpeaking(true)
    speakNext()
  }

  return (
    <main id="top" className={`reader mode-${mode}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Folio reader home"><span className="brand-mark"><BookOpen size={19} /></span><span>folio<span className="brand-period">.</span></span></a>
        <div className="book-meta"><span className="eyebrow">NOW READING</span><span className="book-title">{fileName}</span></div>
        <button className="upload-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={16} /><span>Open a book</span></button>
        <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileChange} aria-label="Upload a PDF or DOCX book" />
      </header>

      <div className="workspace">
        <section className="reading-area" aria-label="Book reader">
          <div className="reading-heading"><div><span className="eyebrow">YOUR READING ROOM</span><h1>A little space to focus.</h1></div><div className="page-indicator"><span>PAGE</span><strong>{String(pageNumber + 1).padStart(2, '0')}</strong><span>/ {String(pages.length).padStart(2, '0')}</span></div></div>

          {pdfDocument && <div className="document-toolbar"><div className="font-switch"><button type="button" className={pdfView === 'text' ? 'active' : ''} aria-pressed={pdfView === 'text'} onClick={() => setPdfView('text')}>Text view</button><button type="button" className={pdfView === 'original' ? 'active' : ''} aria-pressed={pdfView === 'original'} onClick={() => setPdfView('original')}>Original PDF</button></div>{(pdfView === 'original' || !currentPage.text) ? <label>PDF zoom <input aria-label="PDF zoom" type="range" min="100" max="250" step="10" value={zoom} onChange={e => setZoom(Number(e.target.value))} /> {zoom}%</label> : <span className="reader-hint">Adjustable text / original page numbers</span>}</div>}
          <div className={`book-stage turn-${direction} ${flipping ? 'is-flipping' : ''}`}>
            <button className="page-arrow page-arrow-left" type="button" aria-label="Previous page" onClick={() => turnPage(pageNumber - 1)} disabled={pageNumber === 0}><ChevronLeft size={19} /></button>
            <article className={`book-page font-${fontStyle}`} style={{ '--reader-font-size': `${fontSize}px`, '--reader-line-height': lineSpacing } as React.CSSProperties} aria-live="polite">
              <div className="page-running-head"><span>{fileName}</span><span>{String(pageNumber + 1).padStart(2, '0')}</span></div>
              {isLoading ? <div className="loading-page"><span className="loading-rule" /><span className="loading-rule" /><span className="loading-rule short" /><p>Preparing your pages…</p></div> : pdfDocument && (pdfView === 'original' || !currentPage.text) ? <><div className="pdf-scroll"><div style={{ width: `${zoom}%` }}><PdfPage key={`${fileName}-${pageNumber}`} document={pdfDocument} pageNumber={pageNumber + 1} /></div></div>{!currentPage.text && <p className="reader-hint">This page is an image. Use PDF zoom; text size and read aloud require selectable text (OCR).</p>}</> : <div className="page-copy">
                {currentPage.heading && <><span className="chapter-kicker">A MOMENT FOR YOURSELF</span><h2>{currentPage.heading}</h2></>}
                {currentPage.text.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={`${pageNumber}-${index}`}>{paragraph}</p>)}
              </div>}
              <div className="page-footer"><span>FOLIO READER</span><span>{String(pageNumber + 1).padStart(2, '0')}</span></div>
            </article>
            <button className="page-arrow page-arrow-right" type="button" aria-label="Next page" onClick={() => turnPage(pageNumber + 1)} disabled={pageNumber === pages.length - 1}><ChevronRight size={19} /></button>
          </div>

          <div className="reader-footer"><div className="progress-wrap"><div className="progress-label"><span>YOUR PLACE</span><span>{progress}%</span></div><div className="progress-track" role="progressbar" aria-label="Reading progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div></div><div className="page-controls"><button type="button" aria-label="Previous page" onClick={() => turnPage(pageNumber - 1)} disabled={pageNumber === 0}><ChevronLeft size={17} /></button><span>{pageNumber + 1} <i>of</i> {pages.length}</span><button type="button" aria-label="Next page" onClick={() => turnPage(pageNumber + 1)} disabled={pageNumber === pages.length - 1}><ChevronRight size={17} /></button></div></div>
          {error && <div className="error-message" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
        </section>

        <aside className="comfort-panel" aria-label="Reading settings">
          <div className="panel-heading"><div><span className="eyebrow">MAKE IT YOURS</span><h2>Reading comfort</h2></div><span className="panel-spark" aria-hidden="true">✳</span></div>
          <fieldset className="mode-fieldset"><legend>LIGHTING</legend><div className="mode-grid">
            <button className={`mode-option ${mode === 'paper' ? 'selected' : ''}`} type="button" onClick={() => setMode('paper')} aria-pressed={mode === 'paper'}><Sun size={17} /><span>Paper</span></button>
            <button className={`mode-option ${mode === 'lamp' ? 'selected' : ''}`} type="button" onClick={() => setMode('lamp')} aria-pressed={mode === 'lamp'}><LampDesk size={17} /><span>Night lamp</span></button>
            <button className={`mode-option ${mode === 'night' ? 'selected' : ''}`} type="button" onClick={() => setMode('night')} aria-pressed={mode === 'night'}><Moon size={17} /><span>Night</span></button>
            <button className={`mode-option ${mode === 'contrast' ? 'selected' : ''}`} type="button" onClick={() => setMode('contrast')} aria-pressed={mode === 'contrast'}><Contrast size={17} /><span>Glasses</span></button>
          </div></fieldset>

          <div className="setting-block"><div className="setting-label"><span><Type size={15} /> TEXT SIZE</span><span className="size-value">{fontSize}px</span></div><div className="size-control"><button type="button" aria-label="Decrease text size" onClick={() => { setPdfView('text'); setFontSize((size) => Math.max(15, size - 1)) }} disabled={fontSize <= 15}><Minus size={15} /></button><input type="range" min="15" max="28" value={fontSize} onChange={(event) => { setPdfView('text'); setFontSize(Number(event.target.value)) }} aria-label="Text size" /><button type="button" aria-label="Increase text size" onClick={() => { setPdfView('text'); setFontSize((size) => Math.min(28, size + 1)) }} disabled={fontSize >= 28}><Plus size={15} /></button></div></div>

          <fieldset className="font-fieldset"><legend>TYPEFACE</legend><div className="font-switch"><button type="button" className={fontStyle === 'serif' ? 'active' : ''} onClick={() => { setPdfView('text'); setFontStyle('serif') }} aria-pressed={fontStyle === 'serif'}>Serif</button><button type="button" className={fontStyle === 'sans' ? 'active' : ''} onClick={() => { setPdfView('text'); setFontStyle('sans') }} aria-pressed={fontStyle === 'sans'}>Sans serif</button></div></fieldset>

          <label className="extra-setting">Line spacing <select value={lineSpacing} onChange={e => { setPdfView('text'); setLineSpacing(Number(e.target.value)) }}><option value="1.5">Compact</option><option value="1.8">Comfortable</option><option value="2.2">Spacious</option></select></label>
          <form className="jump-form" onSubmit={e => { e.preventDefault(); const n = Number(jumpPage); if (Number.isInteger(n) && n >= 1 && n <= pages.length) turnPage(n - 1) }}><label htmlFor="jump-page">Go to page</label><input id="jump-page" type="number" min="1" max={pages.length} required value={jumpPage} onChange={e => setJumpPage(e.target.value)} /><button disabled={isLoading || flipping}>Go</button></form>
          <button className="bookmark-button" type="button" aria-pressed={bookmarks.includes(pageNumber)} onClick={() => setBookmarks(old => old.includes(pageNumber) ? old.filter(n => n !== pageNumber) : [...old, pageNumber].sort((a, b) => a - b))}>{bookmarks.includes(pageNumber) ? 'Remove bookmark' : 'Bookmark this page'}</button>
          {bookmarks.length > 0 && <div className="bookmark-list" aria-label="Bookmarked pages">{bookmarks.map(n => <button type="button" key={n} onClick={() => turnPage(n)}>Page {n + 1}</button>)}</div>}
          <div className="panel-divider" />
          <div className="utility-heading"><span className="eyebrow">HELPFUL TOOLS</span></div>
          <button type="button" className={`utility-button ${speaking ? 'active' : ''}`} onClick={readAloud} disabled={isLoading || !currentPage.text.trim()}><span className="utility-icon"><Volume2 size={17} /></span><span className="utility-copy"><strong>{speaking ? 'Stop reading' : 'Read aloud'}</strong><small>Listen from page {pageNumber + 1}</small></span><ChevronRight size={16} className="utility-chevron" /></button>
          {speaking && <button className="bookmark-button" type="button" onClick={() => { if (paused) window.speechSynthesis.resume(); else window.speechSynthesis.pause(); setPaused(!paused) }}>{paused ? 'Resume reading' : 'Pause reading'}</button>}
          <label className="extra-setting">Reading speed <select value={speechRate} onChange={e => { stopSpeech(); setSpeechRate(Number(e.target.value)) }}>{[0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}x</option>)}</select></label>
          <div className="translate-tool"><div className="translate-title"><span className="utility-icon"><Languages size={17} /></span><span className="utility-copy"><strong>Translate page</strong><small>Opens Google Translate</small></span></div><div className="translate-controls"><label className="visually-hidden" htmlFor="target-language">Translate to</label><select id="target-language" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>{languages.map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select><button type="button" className="translate-button" onClick={translatePage} disabled={isLoading || !currentPage.text.trim()} aria-label="Translate current page with Google Translate"><Languages size={16} /></button></div></div>
          <div className="privacy-note"><Glasses size={15} /><p>Files stay on this device. Translating sends this page to Google.</p></div>
        </aside>
      </div>
      <footer className="site-footer"><span>MADE FOR THE LOVE OF A GOOD BOOK</span><span>TURN THE PAGE, TAKE YOUR TIME</span></footer>
    </main>
  )
}

export default App
