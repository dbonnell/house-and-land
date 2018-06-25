(function ( $ ) {
  
    // plugin definition
    $.fn.estateMap = function(options) {
        // extend our default options with those provided
        var opts = $.extend(true, {}, $.fn.estateMap.defaults, options);
 
        // plugin data
        var data = $.extend({}, {
            estate: null,  // all data loaded from opts.json URL
            curr: null, // current data node
            prev: null  // previous data node 
        });

        // get the container element (we only expect one)
        var $container = $(this.get(0));

        // add our wrappers to the container
        $container.empty();
        var $mapWrapper = $("<div />")
            .attr(opts.mapWrapperAttrs)
            .appendTo($container);
        var $listWrapper = $("<div />")
            .attr(opts.listWrapperAttrs)
            .appendTo($container);

        var $svg = null;

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
            data.templates = {
                "stageItem": { url: "templates/stage-item.html" }
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

        function loadMap(curr)
        {
            data.curr = curr;
            $mapWrapper.load(appendTimestampToQueryString(curr.plan), null, function (responseText, textStatus, req) {
                if (textStatus == "error") {
                    console.log("Failed to load " + curr.plan + ": " + errorThrown);
                    opts.error.call(this, [responseText, textStatus, req]);
                } else {
                    console.log("Loaded map for " + curr.id + " from " + curr.plan);
                    onMapLoaded();
                }
            });
        }

        function onDataLoaded()
        {
            if (!data.curr) {
                data.curr = data.estate;
            }
            loadMap(data.curr);
        }

        function onMapLoaded(responseText, textStatus, req)
        {
            // grab the SVG document
            $svg = $mapWrapper.find("svg");

            // enforce maximum width
            var width = $svg.attr("width");
            var height = $svg.attr("height");
            var maxWidth = data.curr.maxWidth;
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
            $listWrapper.height(height);

            // make the stage paths look clickable
            var $paths = $svg.find("path");
            $paths.css({ cursor: "pointer" });

            // disable pointer events on the labels so the events pass through to the path underneath
            var $texts = $svg.find("text");
            $texts.css({ "pointer-events": "none" });

            // apply stage availability data to the map
            if (data.curr.stages) {
                applyStageAvailability(data.curr.stages);
            }
            else {
                // TODO: handle data.curr being a stage
            }

            opts.loaded.call(this);
        }

        function getStageAvailabilityTip(value) {
            var availableLots = value.availableLots.length,
                totalLots = value.totalLots;

            var tip =
                "<div class='stageplan-stagetip'>" + availableLots + " lots available.</div>";

            return tip;
        }

        // mouse enter/leave event handlers to highlight lots on hover
        function onStageMouseEnter(e)
        {
            var $lot = $(e.target);
            highlightLot($lot, true);
        }
        function onStageMouseLeave(e)
        {
            var $lot = $(e.target);
            highlightLot($lot, false);
        }
        function onStageButtonMouseEnter(e)
        {
            var $btn = $(e.target).closest(".card");
            var $data = $btn.data("lotinfo");
            var $lot = $("#"+$data.id);
            highlightLot($lot, true);
        }
        function onStageButtonMouseLeave(e)
        {
            var $btn = $(e.target).closest(".card");
            var $data = $btn.data("lotinfo");
            var $lot = $("#"+$data.id);
            highlightLot($lot, false);
        }
        function highlightLot($lot, highlight)
        {
            var $data = $lot.data("lotinfo");
            var $btn = $("#"+$data.id+"_CARD");
            if (highlight) {
                $lot.css("fill-opacity", "1");
                $btn.addClass("highlight");
            } else {
                $lot.css("fill-opacity", "0");
                $btn.removeClass("highlight");
            }
        }

        function stageListItem(stage) {
            var context = { "id": stage.id, "title": stage.label, "available": stage.availableLots.length };
            var html = data.templates.stageItem.template(context);

            return $(html);
        }
        
        function applyStageAvailability(data) {
            // disable pointer events on all SVG elements to prevent interference with tooltips.
            // we will re-enable them on block shapes later.
            $svg.find("*").css("pointer-events", "none");
            
            $listWrapper.empty();
            $.each(data, function (index, value) {
                var location = value.id;
                var $lot = $("#"+location);
                var $badge = $("#"+location+"_BADGE");
                
                // re-enable pointer events for tooltip processing
                $lot.css("pointer-events", "visible");

                // if we have a rect defined for this code then update it
                if ($lot.length == 1) {
                    // attach the data for later reference
                    $lot.data("lotinfo", value);

                    var availableLots = value.availableLots,
                        totalLots = value.totalLots;
                    
                    console.log(location + " has " + availableLots.length + " lots available");
                    
                    // make the lot mask transparent until the user hovers over the lot
                    $lot.css("fill-opacity", "0");
                    
                    // update the available lot count on the badge
                    if ($badge.length == 1) {
                        $badge.find("text").text(availableLots.length);
                        
                        // hide the badge if no availability
                        /*
                        if (availableLots == 0) {
                            $lot.css("display", "none");
                            $badge.css("display", "none");
                        }
                        */
                    }
                    
                    // install mouse enter/leave handlers to highlight the stage on hover
                    $lot.hover(onStageMouseEnter, onStageMouseLeave);

                    // now add a new list item for the stage
                    $listItem = stageListItem(value);
                    $listItem.data("lotinfo", value);
                    $listWrapper.append($listItem);
                    $listItem.hover(onStageButtonMouseEnter, onStageButtonMouseLeave);
                }
            });
        }

        loadData();
     
        return this;
    };


    // plugin defaults
    $.fn.estateMap.defaults = {
        json: "data.json",

        // attributes for the wrapper DIV
        mapWrapperAttrs: {
            class: "landsales landsales-map"
        },
        listWrapperAttrs: {
            class: "landsales landsales-list"
        },

        // callbacks
        error: function() {},       // called on error
        loaded: function() {}       // called after data and map are loaded
    };
 
}( jQuery ));