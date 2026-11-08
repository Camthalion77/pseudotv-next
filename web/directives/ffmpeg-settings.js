'use strict'
module.exports = function (pseudotv) {
    return {
        restrict: 'E',
        templateUrl: 'templates/ffmpeg-settings.html',
        replace: true,
        scope: {},
        link: function (scope) {
            pseudotv.getFfmpegSettings().then(settings => { scope.settings = settings })
            scope.updateSettings = settings => {
                pseudotv.updateFfmpegSettings({
                    _id: settings._id,
                    ffmpegPath: settings.ffmpegPath,
                    logFfmpeg: Boolean(settings.logFfmpeg)
                }).then(updated => { scope.settings = updated })
            }
        }
    }
}
