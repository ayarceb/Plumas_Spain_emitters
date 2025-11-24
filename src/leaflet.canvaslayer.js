L.CanvasLayer = (L.Layer ? L.Layer : L.Class).extend({

    initialize: function (options) {
        L.setOptions(this, options);
    },

    delegate: function (del) {
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
        this._reset();
    },

    onRemove: function (map) {
        map.getPanes().overlayPane.removeChild(this._canvas);
    },

    addTo: function (map) {
        map.addLayer(this);
        return this;
    },

    _reset: function () {
        const size = this._map.getSize();
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        this._redraw();
    },

    _redraw: function () {
        const ctx = this._canvas.getContext('2d');
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

        // CRÍTICO: llamar a drawLayer del delegado
        if (this._delegate && this._delegate.drawLayer) {
            this._delegate.drawLayer({
                canvas: this._canvas,
                ctx: ctx,
                map: this._map
            });
        }
    }
});

L.canvasLayer = function () {
    return new L.CanvasLayer();
};
