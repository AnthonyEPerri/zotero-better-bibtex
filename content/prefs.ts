declare const Zotero: any

declare const Components: any
Components.utils.import('resource://zotero/config.js')
declare const ZOTERO_CONFIG: any

import * as log from './debug'
import { Events } from './events'

import * as defaults from '../gen/preferences/defaults.json'
const supported = Object.keys(defaults)

// export singleton: https://k94n.com/es6-modules-single-instance-pattern
export let Preferences = new class { // tslint:disable-line:variable-name
  public branch: any
  public testing: boolean
  public client: 'zotero' | 'jurism'
  public platform: 'win' | 'lin' | 'mac'

  private prefix = 'translators.better-bibtex'

  constructor() {
    this.testing = Zotero.Prefs.get(this.key('testing'))

    let old, key
    if (typeof (old = Zotero.Prefs.get(key = this.key('suppressTitleCase'))) !== 'undefined') {
      Zotero.Prefs.set(this.key('exportTitleCase'), !old)
      Zotero.Prefs.clear(key)
    }
    if (typeof (old = Zotero.Prefs.get(key = this.key('suppressBraceProtection'))) !== 'undefined') {
      Zotero.Prefs.set(this.key('exportBraceProtection'), !old)
      Zotero.Prefs.clear(key)
    }
    if (typeof (old = Zotero.Prefs.get(key = this.key('suppressSentenceCase'))) !== 'undefined') {
      if (old) {
        Zotero.Prefs.set(this.key('importSentenceCase'), 'off')
      } else {
        Zotero.Prefs.set(this.key('importSentenceCase'), 'on+guess')
      }
      Zotero.Prefs.clear(key)
    }
    if (typeof (old = Zotero.Prefs.get(key = this.key('suppressNoCase'))) !== 'undefined') {
      if (old) {
        Zotero.Prefs.set(this.key('importCaseProtection'), 'off')
      } else {
        Zotero.Prefs.set(this.key('importCaseProtection'), 'as-needed')
      }
      Zotero.Prefs.clear(key)
    }

    for (const [name, value] of Object.entries(defaults)) {
      // https://groups.google.com/forum/#!topic/zotero-dev/a1IPUJ2m_3s
      if (typeof this.get(name) === 'undefined') this.set(name, value);

      (pref => {
        Zotero.Prefs.registerObserver(`${this.prefix}.${pref}`, newValue => {
          Events.emit('preference-changed', pref)
        })
      })(name)
    }

    // no other way for translators to know this. Set after the defaults
    this.set('client', this.client = ZOTERO_CONFIG.GUID.replace(/@.*/, '').replace('-', ''))
    this.set('platform', this.platform = Zotero.platform.toLowerCase().slice(0, 3)) // tslint:disable-line:no-magic-numbers
  }

  public set(pref, value) {
    // if (pref === 'testing' && !value) throw new Error(`preference "${pref}" may not be set to false`)
    if (this.testing && !supported.includes(pref)) throw new Error(`Getting unsupported preference "${pref}"`)
    Zotero.Prefs.set(this.key(pref), value)
  }

  public get(pref) {
    if (this.testing && !supported.includes(pref)) throw new Error(`Getting unsupported preference "${pref}"`)
    return Zotero.Prefs.get(this.key(pref))
  }

  public clear(pref) {
    try {
      Zotero.Prefs.clear(this.key(pref))
    } catch (err) {
      log.error('Prefs.clear', pref, err)
    }
    return this.get(pref)
  }

  private key(pref) { return `${this.prefix}.${pref}` }
}
