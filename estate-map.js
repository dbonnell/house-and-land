(function ( $ ) {
  
    // plugin definition
    $.fn.estateMap = function(options) {
        // extend our default options with those provided
        var opts = $.extend(true, {}, $.fn.estateMap.defaults, options);
 
        // plugin data
        var data = $.extend({}, {
            estate: null,  // all data loaded from opts.json URL
            crumbs: [], // navgiation crumbs
        });

        // get the container element (we only expect one)
        var $container = $(this.get(0));

        // add our wrappers to the container
        $container.empty();
        $container.addClass("landsales");

        // variables to hold wrappers and svg, once loaded
        var $mapWrapper;
        var $listWrapper;
        var $svg;

        //#region utility methods
        function appendTimestampToQueryString(url)
        {
            var ts = (new Date().getTime());
            if (url.indexOf("?") > 0) {
                url += "&ts=" + ts;
            }
            else {
                url += "?ts=" + ts;
            }

            return url;
        }
        //#endregion

        //#region data loading
        function loadData()
        {
            var resources = [];
            if (opts.json) {
                resources.push(
                    $.getJSON(appendTimestampToQueryString(opts.json)).done(function (responseText, textStatus, jqXHR) {
                        console.log("Loaded estate data from " + opts.json);
                        data.estate = responseText;
                    })
                );
            }

            // our handlebar templates
            // we will load and compile them all upfront to avoid any delays later
            data.templates = {
                "estateView": { url: "templates/estate-view.html" },
                "stageView": { url: "templates/stage-view.html" },
                "stageItem": { url: "templates/stage-item.html" },
                "lotItem": { url: "templates/lot-item.html" }
            };
            var templates = [];
            $.each(data.templates, function(name, el) {
                templates.push(
                    $.get(appendTimestampToQueryString(el.url)).done(function (responseText, textStatus, jqXHR) {
                        console.log("Loaded template " + name + " from " + el.url);
                        el.template = Handlebars.compile(responseText);
                    })
                );
            });
            resources = resources.concat(templates);

            // wait for all resources to load before calling onDataLoaded
            $.when.apply(resources, resources)
                .done(function() {
                    console.log("All resources loaded");
                    onDataLoaded();
                });
        }

        function onDataLoaded()
        {
            loadMap(data.estate);

            // uncomment the 2 lines below to test loading of first stage on startup
            /*
            data.crumbs.push(data.estate);
            loadMap(data.estate.stages[0]);
            */
            
        }
        //#endregion

        //#region data navigation
        function current() {
            var curr = undefined;
            
            if (data.crumbs && data.crumbs.length >= 1)
                curr = data.crumbs[data.crumbs.length - 1];

            return curr;
        }

        function isEstate() {
            return current().hasOwnProperty("stages");
        }
        function isStage() {
            return current().hasOwnProperty("availableLots");
        }
        function isLot() {
            return (!isEstate() && !isStage());
        }
        //#endregion

        //#region load estate/stage/lot
        function loadMap(map)
        {
            if (!map) {
                // go back to previous breadcrumb
                data.crumbs.pop();  // pop current
                map = current();    // set top as current
            } else {
                if (!map.hasOwnProperty("plan")) {
                    // doesn't have a plan yet, ignore navigation request
                    console.log("Ignoring request to load " + map.id + " as it does not have a plan");
                    return;
                }
                data.crumbs.push(map);
            }
            console.log("Changing to " + map.label + " [" + map.id + "]");

            // load the estate or stage view into $container
            var $view;
            if (isEstate()) {
                console.log("Setting view to ESTATE");
                $view = estateView(map);
            } else if (isStage()) {
                console.log("Setting view to STAGE");
                $view = stageView(map);
            }
            else {
                console.log("Setting view to LOT");
                $view = lotView(map);
            }
            //$container.empty().append($view);
            $mapWrapper = $view.find(".landsales-map");
            $listWrapper = $view.find(".landsales-list");

            // attach click handler to "back to masterplan" nav button
            if (isStage()) {
                $view.find("#stage-nav").click( function () { loadMap(); } );
            }

            $mapWrapper.load(appendTimestampToQueryString(map.plan), null, function (responseText, textStatus, req) {
                if (textStatus == "error") {
                    var errorThrown = "HTTP " + req.status + " " + req.statusText;
                    console.log("Failed to load " + map.plan + ": " + errorThrown);
                    loadMap();  // couldn't load this one so return to previous map
                    opts.error.call(this, [responseText, textStatus, req]);
                } else {
                    console.log("Loaded map for " + map.id + " from " + map.plan);
                    onMapLoaded($view);
                }
            });
        }

        function onMapLoaded($view)
        {
            // grab the SVG document
            $svg = $mapWrapper.find("svg");

            // enforce maximum width
            var width = $svg.attr("width");
            var height = $svg.attr("height");
            if (width.indexOf("mm") >= 0) {
                console.log("OOPS!  SVG width/height are in mm.  Please set Document Properties/Custom Size units to px");
            }
            var maxWidth = current().maxWidth;
            if (maxWidth != undefined && maxWidth > 0 && width > maxWidth) {
                // preserve aspect ratio on resize
                if ($svg.attr("preserveAspectRatio") == undefined) {
                    $svg.attr("preserveAspectRatio", "xMinYMin meet");
                }
                var scale = maxWidth / width;
                width = Math.floor(width * scale);
                height = Math.floor(height * scale);
                $svg.attr("width", width);
                $svg.attr("height", height);
            }

            // resize the wrapper divs
            $mapWrapper.width(width);
            $mapWrapper.height(height);
            if ( isEstate() ) {
                $listWrapper.width(width-30);   // -30px to offset 15+15 margins of .fluid-container
            } else {
                $listWrapper.height(height);
            }

            // make the stage paths look clickable
            var $paths = $svg.find("path");
            $paths.css({ cursor: "pointer" });

            // disable pointer events on the labels so the events pass through to the path underneath
            var $texts = $svg.find("text");
            $texts.css({ "pointer-events": "none" });

            // apply stage availability data to the map
            if ( isEstate() ) {
                applyStageAvailability($view);
            }
            else if ( isStage() ) {
                applyLotAvailability($view);
            }
            else {
                applyLotPackages($view);
            }

            // ok, everything is ready, now lets switch to the new view
            $container.fadeOut(200, function() {
                $container.empty().append($view);
                $container.fadeIn(200);
            });

            opts.loaded.call(this);
        }
        //#endregion

        //#region mouse enter/leave event handlers to highlight stages on hover
        function onStageMouseEnter(e)
        {
            var $stage = $(e.target);
            highlightItem($stage, true);
        }
        function onStageMouseLeave(e)
        {
            var $stage = $(e.target);
            highlightItem($stage, false);
        }
        function onStageButtonMouseEnter(e)
        {
            var $btn = $(e.target).closest(".card");
            var $data = $btn.data("landsales_data");
            var $stage = $("#"+$data.id);
            highlightItem($stage, true);
        }
        function onStageButtonMouseLeave(e)
        {
            var $btn = $(e.target).closest(".card");
            var $data = $btn.data("landsales_data");
            var $stage = $("#"+$data.id);
            highlightItem($stage, false);
        }
        function highlightItem($lot, highlight)
        {
            var $data = $lot.data("landsales_data");
            var $btn = $("#"+$data.id+"_CARD");
            if (highlight) {
                $lot.css("fill-opacity", "1");
                $btn.addClass("highlight");
            } else {
                $lot.css("fill-opacity", "0");
                $btn.removeClass("highlight");
            }
        }
        //#endregion

        //#region mouse enter/leave event handlers to highlight lots on hover
        function onLotMouseEnter(e)
        {
            var $lot = $(e.target);
            highlightItem($lot, true);
        }
        function onLotMouseLeave(e)
        {
            var $lot = $(e.target);
            highlightItem($lot, false);
        }
        function onLotButtonMouseEnter(e)
        {
            var $btn = $(e.target).closest(".card");
            var $data = $btn.data("landsales_data");
            var $lot = $("#"+$data.id);
            highlightItem($lot, true);
        }
        function onLotButtonMouseLeave(e)
        {
            var $btn = $(e.target).closest(".card");
            var $data = $btn.data("landsales_data");
            var $lot = $("#"+$data.id);
            highlightItem($lot, false);
        }
        //#endregion

        //#region view instantiation
        function estateView(context)
        {
            var html = data.templates.estateView.template(context);

            return $(html);
        }
        function stageView(context)
        {
            var html = data.templates.stageView.template(context);

            return $(html);
        }
        function stageListItem(stage) {
            var context = $.extend({}, stage, { "available": stage.availableLots.length });
            var html = data.templates.stageItem.template(context);

            return $(html);
        }
        function lotListItem(lot) {
            var context = $.extend({}, lot, {});
            var html = data.templates.lotItem.template(context);

            return $(html);
        }
        //#endregion

        
        function applyStageAvailability($view) {
            // disable pointer events on all SVG elements to prevent interference with tooltips.
            // we will re-enable them on block shapes later.
            $svg.find("*").css("pointer-events", "none");
            
            $listWrapper.empty();
            $listRow = $("<div />").addClass("row").appendTo($listWrapper);

            var estate = current();
            $.each(estate.stages, function (index, stage) {
                var location = stage.id;    // e.g. STAGE105
                var $stage = $view.find("#"+location);
                var $badge = $view.find("#"+location+"_BADGE");
                

                // if we have a rect defined for this code then update it
                if ($stage.length == 1) {
                    // attach the data for later reference
                    $stage.data("landsales_data", stage);

                    var availableLots = stage.availableLots,
                        totalLots = stage.totalLots;
                    
                    console.log(location + " has " + availableLots.length + " lots available");
                    
                    // make the lot mask transparent until the user hovers over the lot
                    $stage.css("fill-opacity", "0");
                    
                    // update the available lot count on the badge
                    if ($badge.length == 1) {
                        $badge.find("text").text(availableLots.length);
                        
                        // hide the badge if no availability?
                        /*
                        if (availableLots == 0) {
                            $stage.css("display", "none");
                            $badge.css("display", "none");
                        }
                        */
                    }
                    
                    // install mouse enter/leave handlers to highlight the stage on hover
                    $stage.css("pointer-events", "visible");
                    $stage.hover(onStageMouseEnter, onStageMouseLeave);

                    // now add a new list item for the stage
                    $listItem = stageListItem(stage);
                    $listItem.data("landsales_data", stage);
                    $listRow.append($listItem);
                    $listItem.hover(onStageButtonMouseEnter, onStageButtonMouseLeave);

                    // add click handler to navigate to the stage view
                    $stage.click(function () { loadMap(stage); });
                    $listItem.click(function () { loadMap(stage); });
                }
            });
        }

        function applyLotAvailability($view) {
            // disable pointer events on all SVG elements to prevent interference with tooltips.
            // we will re-enable them on block shapes later.
            $svg.find("*").css("pointer-events", "none");
            
            $listWrapper.empty();
            $listRow = $("<div />").addClass("row").appendTo($listWrapper);

            var stage = current();

            // badges for all lots in the SVG are initially sold
            
            // for each available lots:
            // 1. hide their badge (#LOTnnn_BADGE)
            // 2. add mouseenter/leave handlers to toggle visibility of the lot mask (#LOTnnn)
            $.each(stage.availableLots, function (index, lot) {
                var location = lot.id;    // e.g LOT119
                var $lot = $view.find("#"+location);
                var $badge = $view.find("#"+location+"_BADGE");     // group with cover rect + status circle (fill=#000, opacity=0.5)
                var $status = $view.find("#"+location+"_STATUS");   // status circle (fill=ref, opacity=1.0)
                

                // if we have a rect defined for this code then update it
                if ($lot.length == 1) {
                    // attach the data for later reference
                    $lot.data("landsales_data", lot);
                    
                    console.log(location + " is available");
                    
                    // make the lot mask transparent until the user hovers over the lot
                    $lot.css("fill-opacity", "0");

                    // hide the badge as this lot is available
                    $badge.css("display", "none");
                    

                    // now add a new list item for the stage
                    $listItem = lotListItem(lot);
                    $listItem.data("landsales_data", lot);
                    $listRow.append($listItem);

                    // add mouse enter/leave handlers to highlight the lot on hover
                    $lot.css("pointer-events", "visible");
                    $lot.hover(onLotMouseEnter, onLotMouseLeave);
                    $listItem.hover(onLotButtonMouseEnter, onLotButtonMouseLeave);

                    // add click handlers to navigate to the lot view
                    // TODO
                    $lot.click(function () { loadMap(lot); });
                    $listItem.click(function () { loadMap(lot); });
                }
            });
        }

        function applyLotPackages($view) {
            // TODO
        }

        loadData();
     
        return this;
    };


    // plugin defaults
    $.fn.estateMap.defaults = {
        json: "data.json",

        // attributes for the wrapper DIV
        mapWrapperAttrs: {
            class: "landsales-map"
        },
        listWrapperAttrs: {
            class: "landsales-list container-fluid"
        },

        // callbacks
        error: function() {},       // called on error
        loaded: function() {}       // called after data and map are loaded
    };
 
}( jQuery ));