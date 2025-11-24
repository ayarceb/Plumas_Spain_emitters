L.CanvasLayer = (L.Layer ? L.Layer : L.Class).extend({
    initialize: function (options) {
        L.setOptions(this, options);
    },

    delegate: function(del) {
        this._delegate = del;
        return this;
    },

    onAdd: function (map) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-layer');
        const size = this._map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;

        const pane = map.getPanes().overlayPane;
        pane.appendChild(this._canvas);

        map.on('moveend', this._reset, this);
    },

    onRemove: function (map) {
        map.getPanes().overlayPane.removeChild(this._canvas);
    },

    _reset: function () {
        const size = this._map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;

        this._redraw();
    },

    _redraw: function () {
        if (!this._delegate) return;
        this._delegate.drawLayer({
            canvas: this._canvas,
            bounds: this._map.getBounds()
        });
    }
});

L.canvasLayer = function () {
    return new L.CanvasLayer();
};
