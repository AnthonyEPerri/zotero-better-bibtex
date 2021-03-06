declare const Zotero: any
declare const ZOTERO_TRANSLATOR_INFO: any

import * as preferences from '../../gen/preferences/defaults.json'
import { client } from '../../content/client'

type TranslatorMode = 'export' | 'import'

const cacheDisabler = new class {
  get(target, property) {
    // collections: jabref 4 stores collection info inside the reference, and collection info depends on which part of your library you're exporting
    if (['collections'].includes(property)) target.cachable = false
    return target[property]
  }
}

export let Translator = new class implements ITranslator { // tslint:disable-line:variable-name
  public preferences: IPreferences
  public skipFields: string[]
  public skipField: Record<string, boolean>
  public verbatimFields?: string[]
  public csquotes: { open: string, close: string }
  public export: { dir: string, path: string } = { dir: undefined, path: undefined }

  public options: {
    quickCopyMode?: string
    dropAttachments?: boolean
    exportNotes?: boolean
    exportFileData?: boolean
    useJournalAbbreviation?: boolean
    keepUpdated?: boolean
    Title?: boolean
    Authors?: boolean
    Year?: boolean
    Normalize?: boolean
  }

  public BetterBibLaTeX?: boolean                   // tslint:disable-line:variable-name
  public BetterBibTeX?: boolean                     // tslint:disable-line:variable-name
  public BetterTeX: boolean                         // tslint:disable-line:variable-name
  public BetterCSLJSON?: boolean                    // tslint:disable-line:variable-name
  public BetterCSLYAML?: boolean                    // tslint:disable-line:variable-name
  public BetterCSL?: boolean                        // tslint:disable-line:variable-name
  public BetterBibTeXCitationKeyQuickCopy?: boolean // tslint:disable-line:variable-name
  public BetterBibTeXJSON?: boolean                 // tslint:disable-line:variable-name
  public Citationgraph?: boolean                    // tslint:disable-line:variable-name
  public Collectednotes?: boolean                   // tslint:disable-line:variable-name
  // public TeX: boolean
  // public CSL: boolean

  private cachable: boolean
  public cache: {
    hits: number
    misses: number
  }

  public header: {
    translatorID: string
    translatorType: number
    label: string
    description: string
    creator: string
    target: string
    minVersion: string
    maxVersion: string
    priority: number
    inRepository: boolean
    lastUpdated: string
    browserSupport: string

    displayOptions: {
      exportNotes: boolean
      exportFileData: boolean
      useJournalAbbreviation: boolean
      keepUpdated: boolean
      quickCopyMode: string
      Title: boolean
      Authors: boolean
      Year: boolean
      Normalize: boolean
    }

    configOptions: {
      getCollections: boolean
      async: boolean
    }
  }

  public collections: Record<string, ZoteroCollection>
  private sortedItems: ISerializedItem[]
  private currentItem: ISerializedItem

  public isJurisM: boolean
  public isZotero: boolean
  public unicode: boolean
  public platform: string
  public paths: {
    caseSensitive: boolean
    sep: string
  }

  public stringCompare: (a: string, b: string) => number

  public initialized = false

  constructor() {
    this.header = ZOTERO_TRANSLATOR_INFO

    this[this.header.label.replace(/[^a-z]/ig, '')] = true
    this.BetterTeX = this.BetterBibTeX || this.BetterBibLaTeX
    this.BetterCSL = this.BetterCSLJSON || this.BetterCSLYAML
    this.preferences = preferences
    this.options = this.header.displayOptions || {}

    this.stringCompare = (new Intl.Collator('en')).compare
  }

  public get exportDir(): string {
    this.currentItem.cachable = false
    return this.export.dir
  }

  public get exportPath(): string {
    this.currentItem.cachable = false
    return this.export.path
  }

  private typefield(field) {
    field = field.trim()
    if (field.startsWith('bibtex.')) return this.BetterBibTeX ? field.replace(/^bibtex\./, '') : ''
    if (field.startsWith('biblatex.')) return this.BetterBibLaTeX ? field.replace(/^biblatex\./, '') : ''
    return field
  }

  public init(mode: TranslatorMode) {
    this.platform = Zotero.getHiddenPref('better-bibtex.platform')
    this.isJurisM = client === 'jurism'
    this.isZotero = !this.isJurisM

    this.paths = {
      caseSensitive: this.platform !== 'mac' && this.platform !== 'win',
      sep: this.platform === 'win' ? '\\' : '/',
    }

    for (const key in this.options) {
      if (typeof this.options[key] === 'boolean') {
        this.options[key] = !!Zotero.getOption(key)
      } else {
        this.options[key] = Zotero.getOption(key)
      }
    }

    // special handling
    if (mode === 'export') {
      this.cache = {
        hits: 0,
        misses: 0,
      }
      this.export = {
        dir: Zotero.getOption('exportDir'),
        path: Zotero.getOption('exportPath'),
      }
      if (this.export.dir && this.export.dir.endsWith(this.paths.sep)) this.export.dir = this.export.dir.slice(0, -1)
    }

    for (const pref of Object.keys(this.preferences)) {
      let value

      try {
        value = Zotero.getOption(`preference_${pref}`)
      } catch (err) {
        value = undefined
      }

      if (typeof value === 'undefined') value = Zotero.getHiddenPref(`better-bibtex.${pref}`)

      this.preferences[pref] = value
    }

    // special handling
    this.skipFields = this.preferences.skipFields.toLowerCase().split(',').map(field => this.typefield(field)).filter(s => s)
    this.skipField = this.skipFields.reduce((acc, field) => { acc[field] = true; return acc }, {})

    this.verbatimFields = this.preferences.verbatimFields.toLowerCase().split(',').map(field => this.typefield(field)).filter(s => s)

    if (!this.verbatimFields.length) this.verbatimFields = null
    this.csquotes = this.preferences.csquotes ? { open: this.preferences.csquotes[0], close: this.preferences.csquotes[1] } : null

    this.preferences.testing = Zotero.getHiddenPref('better-bibtex.testing')

    if (mode === 'export') {
      this.unicode = (this.BetterBibTeX && !Translator.preferences.asciiBibTeX) || (this.BetterBibLaTeX && !Translator.preferences.asciiBibLaTeX)

      // when exporting file data you get relative paths, when not, you get absolute paths, only one version can go into the cache
      // relative file paths are going to be different based on the file being exported to
      this.cachable = !(this.options.exportFileData || this.preferences.relativeFilePaths)
    }

    this.collections = {}
    if (mode === 'export' && this.header.configOptions?.getCollections && Zotero.nextCollection) {
      let collection
      while (collection = Zotero.nextCollection()) {
        const children = collection.children || collection.descendents || []
        const key = (collection.primary ? collection.primary : collection).key

        this.collections[key] = {
          // id: collection.id,
          key,
          parent: collection.fields.parentKey,
          name: collection.name,
          items: collection.childItems,
          collections: children.filter(coll => coll.type === 'collection').map(coll => coll.key),
          // items: (item.itemID for item in children when item.type != 'collection')
          // descendents: undefined
          // children: undefined
          // childCollections: undefined
          // primary: undefined
          // fields: undefined
          // type: undefined
          // level: undefined
        }
      }

      for (collection of Object.values(this.collections)) {
        if (collection.parent && !this.collections[collection.parent]) {
          collection.parent = false
          Zotero.debug(`BBT translator: collection with key ${collection.key} has non-existent parent ${collection.parent}, assuming root collection`)
        }
      }
    }

    this.initialized = true
  }

  public items(): ISerializedItem[] {
    if (!this.sortedItems) {
      this.sortedItems = []
      let item
      while (item = Zotero.nextItem()) {
        item.cachable = this.cachable
        item.journalAbbreviation = item.journalAbbreviation || item.autoJournalAbbreviation
        this.sortedItems.push(new Proxy(item, cacheDisabler))
      }
      // fallback to itemType.itemID for notes and attachments. And some items may have duplicate keys
      this.sortedItems.sort((a, b) => {
        const ka = [ a.citationKey || a.itemType, a.dateModified || a.dateAdded, a.itemID ].join('\t')
        const kb = [ b.citationKey || b.itemType, b.dateModified || b.dateAdded, b.itemID ].join('\t')
        return ka.localeCompare(kb, undefined, { sensitivity: 'base' })
      })
    }
    return this.sortedItems
  }

  public nextItem() {
    return (this.currentItem = this.items().shift())
  }
}
