'use strict'

// Minimal streaming XML writer for the original PseudoTV generator.
// Replaces the missing xml-writer package without changing XMLTV's schedule logic.
const escapeXML = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

class XMLWriter {
    constructor(pretty, write) {
        this.write = write
        this.stack = []
        this.open = false
    }
    startDocument() { this.write('<?xml version="1.0" encoding="UTF-8"?>\n') }
    finishOpen() {
        if (this.open) { this.write('>'); this.open = false }
    }
    startElement(name) {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) throw Error('Invalid XML element')
        this.finishOpen()
        this.write('<' + name)
        this.stack.push(name)
        this.open = true
        return this
    }
    writeAttribute(name, value) {
        if (!this.open) throw Error('Attribute outside opening element')
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) throw Error('Invalid XML attribute')
        this.write(' ' + name + '="' + escapeXML(value) + '"')
        return this
    }
    text(value) { this.finishOpen(); this.write(escapeXML(value)); return this }
    writeRaw(value) { this.finishOpen(); this.write(String(value)); return this }
    writeElement(name, value) { return this.startElement(name).text(value).endElement() }
    endElement() {
        const name = this.stack.pop()
        if (!name) throw Error('Unbalanced XML')
        if (this.open) { this.write('/>'); this.open = false }
        else this.write('</' + name + '>')
        return this
    }
    endDocument() {
        if (this.stack.length) throw Error('XML document not closed')
        this.write('\n')
    }
}
module.exports = XMLWriter
