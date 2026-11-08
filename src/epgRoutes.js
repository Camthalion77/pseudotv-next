'use strict'
const express = require('express')
const fs = require('fs')
const createImageHandler = require('./epgImages')
function publicProgramme(p) {
    const {server,file,key,opts,streams,commercials,thumbPath,iconPath,_cachedAt,...safe} = p
    return safe
}
module.exports = function epgRoutes(epg, xmltvInterval, db, dataDir) {
    const router = express.Router()
    router.get('/api/epg', (req,res) => {
        const hours = Math.min(336,Math.max(1,Number(req.query.hours)||6))
        const now = Number(req.query.at)||Date.now()
        if (!Number.isFinite(now) || Math.abs(Date.now()-now)>40*86400000) return res.status(400).json({error:'Invalid date'})
        res.json({channels:epg.channels().map(ch=>({number:ch.number,name:ch.name,icon:ch.icon && !/X-Plex-Token/i.test(ch.icon)?ch.icon:null})),
            programmes:epg.listing(now,hours).map(publicProgramme), generatedAt:new Date().toISOString()})
    })
    router.get('/api/epg/status', (req,res) => res.json({lastRefresh:xmltvInterval.lastRefresh, metadataEntries:epg.cachedCount, refreshRunning:xmltvInterval.refreshRunning||false}))
    router.post('/api/epg/refresh', (req,res) => {
        // Explicit refresh can be requested from the local admin UI.
        if (xmltvInterval.refreshRunning) return res.status(409).json({error:'Refresh already running'})
        xmltvInterval.refreshRunning=true
        epg.refresh(true).then(() => xmltvInterval.updateXML()).catch(e=>console.error('EPG manual refresh',e))
            .finally(()=>{xmltvInterval.refreshRunning=false})
        res.status(202).json({status:'started'})
    })
    router.get('/api/epg-image/:id',createImageHandler(epg,dataDir))
    return router
}
