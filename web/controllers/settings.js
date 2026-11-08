module.exports = function ($scope, $location) {
    $scope.selected = $location.hash()
    if (!['xmltv', 'plex', 'hdhr'].includes($scope.selected))
        $scope.selected = 'xmltv'
}