module.exports = function (plex, pseudotv, $timeout) {
    return {
        restrict: 'E',
        templateUrl: 'templates/plex-library.html',
        replace: true,
        scope: {
            onFinish: "=onFinish",
            height: "=height",
            visible: "=visible"
        },
        link: function (scope, element, attrs) {
            scope.selection = []
            scope.selectServer = function (server) {
                scope.plexServer = server
                updateLibrary(server)
            }
            scope._onFinish = (s) => {
                scope.onFinish(s)
                scope.selection = []
                scope.visible = false
            }
            scope.selectItem = (item) => {
                return new Promise((resolve, reject) => {
                    $timeout(async () => {
                        item.streams = await plex.getStreams(scope.plexServer, item.key)
                        scope.selection.push(JSON.parse(angular.toJson(item)))
                        scope.$apply()
                        resolve()
                    }, 0)
                })
            }
            pseudotv.getPlexServers().then((servers) => {
                if (servers.length === 0) {
                    scope.noServers = true
                    return
                }
                scope.plexServers = servers
                scope.plexServer = servers[0]
                updateLibrary(scope.plexServer)
            })

            function updateLibrary(server) {
                scope.libraries = []
                scope.loadError = null
                scope.loadingLibrary = true
                plex.getLibrary(server).then(async (libraries) => {
                    let playlists = []
                    try { playlists = await plex.getPlaylists(server) } catch (error) {
                        // An unavailable playlist endpoint must not hide the libraries.
                        console.warn('Plex playlists unavailable', error)
                    }
                    playlists.forEach(playlist => { playlist.type = 'playlist' })
                    scope.$applyAsync(() => {
                        scope.libraries = libraries
                        if (playlists.length) scope.libraries.push({ title: 'Playlists', key: '', icon: '', nested: playlists })
                        scope.loadingLibrary = false
                    })
                }).catch(error => {
                    console.error('Plex library unavailable', error)
                    scope.$applyAsync(() => {
                        scope.loadingLibrary = false
                        scope.loadError = error && error.data && error.data.error || 'Αποτυχία φόρτωσης βιβλιοθηκών Plex.'
                    })
                })
            }
            scope.getNested = (list) => {
                $timeout(async () => {
                    if (typeof list.nested === 'undefined')
                        list.nested = await plex.getNested(scope.plexServer, list.key)
                    list.collapse = !list.collapse
                    scope.$apply()
                }, 0)
            }
            
            scope.selectSeason = (season) => {
                return new Promise((resolve, reject) => {
                    $timeout(async () => {
                        if (typeof season.nested === 'undefined')
                            season.nested = await plex.getNested(scope.plexServer, season.key)
                        for (let i = 0, l = season.nested.length; i < l; i++)
                            await scope.selectItem(season.nested[i])
                        scope.$apply()
                        resolve()
                    }, 0)
                })
            }
            scope.selectShow = (show) => {
                return new Promise((resolve, reject) => {
                    $timeout(async () => {
                        if (typeof show.nested === 'undefined')
                            show.nested = await plex.getNested(scope.plexServer, show.key)
                        for (let i = 0, l = show.nested.length; i < l; i++) 
                            await scope.selectSeason(show.nested[i])
                        scope.$apply()
                        resolve()
                    }, 0)
                })
            }
            scope.selectPlaylist = async (playlist) => {
                return new Promise((resolve, reject) => {
                    $timeout(async () => {
                        if (typeof playlist.nested === 'undefined')
                            playlist.nested = await plex.getNested(scope.plexServer, playlist.key)
                        for (let i = 0, l = playlist.nested.length; i < l; i++)
                            await scope.selectItem(playlist.nested[i])
                        scope.$apply()
                        resolve()
                    }, 0)
                })
            }
            scope.createShowIdentifier = (season, ep) => {
                return 'S' + (season.toString().padStart(2, '0')) + 'E' + (ep.toString().padStart(2, '0'))
            }
        }
    };
}