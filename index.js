'use strict'
const db = require('diskdb')
const fs = require('fs')
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const api = require('./src/api')
const video = require('./src/video')
const HDHR = require('./src/hdhr')
const xmltv = require('./src/xmltv')
const Plex = require('./src/plex')
const { createService } = require('./src/epg')
const epgRoutes = require('./src/epgRoutes')

for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === '-p' || process.argv[i] === '--port') process.env.PORT = process.argv[i + 1]
    if (process.argv[i] === '-d' || process.argv[i] === '--database') process.env.DATABASE = process.argv[i + 1]
}
const dataPath = process.env.DATABASE || './.pseudotv'
process.env.DATABASE = dataPath
process.env.PORT = process.env.PORT || '8000'
fs.mkdirSync(path.join(dataPath, 'images'), {recursive: true})
const iconFile = path.join(dataPath, 'images', 'pseudotv.png')
if (!fs.existsSync(iconFile)) fs.copyFileSync(path.join(__dirname, 'resources', 'pseudotv.png'), iconFile)

db.connect(dataPath, ['channels', 'plex-servers', 'ffmpeg-settings', 'xmltv-settings', 'hdhr-settings'])
const ffmpegRows = db['ffmpeg-settings'].find()
if (!ffmpegRows.length) db['ffmpeg-settings'].save({ffmpegPath:'/usr/bin/ffmpeg', logFfmpeg:false})
if (!db['xmltv-settings'].find().length) db['xmltv-settings'].save({cache:336,refresh:6,file:path.join(dataPath,'xmltv.xml')})
if (!db['hdhr-settings'].find().length) db['hdhr-settings'].save({tunerCount:1,autoDiscovery:true})

const epg = createService(db, dataPath)
const publicBase = (process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT}`).replace(/\/$/, '')
const xmltvInterval = {
    interval: null,
    lastRefresh: null,
    updateXML() {
        const channels = db.channels.find().sort((a,b) => Number(a.number)-Number(b.number))
        const settings = db['xmltv-settings'].find()[0]
        return xmltv.WriteXMLTV(epg.channels(), settings, publicBase).then(async () => {
            this.lastRefresh = new Date()
            for (const server of db['plex-servers'].find()) {
                if (!server.arGuide && !server.arChannels) continue
                try {
                    const plex = new Plex(server)
                    const dvrs = await plex.GetDVRS()
                    if (server.arGuide) await plex.RefreshGuide(dvrs)
                    if (server.arChannels && channels.length) await plex.RefreshChannels(channels, dvrs)
                } catch (err) { console.error('Plex DVR guide update:', err.message || err) }
            }
        }).catch(err => console.error('XMLTV update failed:', err.message || err))
    },
    startInterval() {
        const settings = db['xmltv-settings'].find()[0]
        const hours = Number(settings.refresh)
        if (Number.isFinite(hours) && hours > 0) this.interval = setInterval(() => this.updateXML(), hours * 3600000)
    },
    restartInterval() { if (this.interval) clearInterval(this.interval); this.interval = null; this.startInterval() }
}
xmltvInterval.updateXML()
epg.refresh().then(()=>xmltvInterval.updateXML()).catch(err=>console.error('Initial Plex metadata refresh:',err.message))
xmltvInterval.startInterval()
setInterval(() => epg.refresh().then(()=>xmltvInterval.updateXML()).catch(err=>console.error('EPG sync:',err.message)),6*3600000).unref()
const hdhr = HDHR(db)
const app = express()
app.use(bodyParser.json({limit:'50mb'}))
app.use(express.static(path.join(__dirname,'web/public')))
app.use('/images', express.static(path.join(dataPath,'images')))
app.use(api.router(db, xmltvInterval))
app.use(epgRoutes(epg, xmltvInterval, db, dataPath))
app.use(video.router(db))
app.use(hdhr.router)
app.listen(Number(process.env.PORT), () => {
    console.log(`PseudoTV Next Direct Stream listening on port ${process.env.PORT}`)
    const setting = db['hdhr-settings'].find()[0]
    if (process.env.HDHR_DISCOVERY !== 'false' && setting.autoDiscovery === true) hdhr.ssdp.start()
})
