﻿// Knockout DataTables 0.2.2
// (c) Sławomir Rosiek - https://github.com/rosieks/knockout.datatables
// License: MIT (http://www.opensource.org/licenses/mit-license.php)

/* jshint -W069 */

(function ($, ko) {
    ko.gridModel = function (requestData) {
        var parametersKey = '__ko_gridModel_';
        var parameters = {
            skip: ko.observable(0),
            top: ko.observable(20),
            sortField: ko.observable(),
            sortOrder: ko.observable('ASC')
        },
        key = ko.observable('Id'),
        inProgress = ko.observable(false),
        lastParameters = clone(parameters),
        canFetch = ko.observable(false),
        forceFetch = false,
        result = { items: ko.observableArray(), totalRows: ko.observable() };
        ko.computed(_requestData, parameters).extend({ rateLimit: 0 });

        var model = {
            parameters: parameters,
            result: result,
            load: load,
            store: store,
            fetch: fetch,
            fetchInProgress: inProgress,
            key: key
        };

        return model;

        function _requestData() {
            if (canFetch() && (isDifferent(lastParameters, parameters) || forceFetch)) {
                lastParameters = clone(parameters);
                forceFetch = false;
                inProgress(true);
                $.proxy(requestData, parameters)().done(function (items, totalRows) {
                    result.totalRows(totalRows);
                    result.items(items);
                }).always(function () {
                    inProgress(false);
                });
            } else {
                setTimeout(result.items.valueHasMutated, 0);
            }
        }

        function load(name) {
            var obj = JSON.parse(sessionStorage.getItem(parametersKey + name));
            for (var field in obj) {
                var value = parameters[field];
                if (ko.isWriteableObservable(value) && !ko.isComputed(value)) {
                    value(obj[field]);
            }
        }

            return model;
        }

        function store(name) {
            var obj = {};
            for (var field in parameters) {
                var value = parameters[field];
                if (ko.isObservable(value) && !ko.isComputed(value)) {
                    obj[field] = ko.unwrap(value);
                }
        }
            sessionStorage.setItem(parametersKey + name, JSON.stringify(obj));
        }

        function fetch(options) {
            options = $.extend({}, { force: false }, options);
            forceFetch = options.force;
            canFetch(true);
            canFetch.notifySubscribers(true);
            return model;
        }
        
        function isDifferent(previous, pending) {
            for (var p in pending) {
                if (ko.unwrap(previous[p]) !== ko.unwrap(pending[p])) {
                    return true;
                }
            }
            return false;
        }

        function clone(value) {
            var v = {};
            for (var p in value) {
                v[p] = ko.unwrap(value[p]);
            }
            return v;
        }
    };
    ko.gridModel.inMemory = function (items) {
        return ko.gridModel(function () {
            var dfd = $.Deferred();
            var start = this.skip(),
                end = this.skip() + this.top(),
                sortField = this.sortField(),
                sortMultiplier = this.sortOrder() === 'asc' ? -1 : 1;

            setTimeout(function () {
                var result = [];
                items.sort(function (i, j) {
                    if (ko.unwrap(i[sortField]) < ko.unwrap(j[sortField])) {
                        return sortMultiplier;
                    } else if (ko.unwrap(i[sortField]) > ko.unwrap(j[sortField])) {
                        return -sortMultiplier;
                    } else {
                        return 0;
                    }
                });

                for (var i = start, j = ko.unwrap(items).length; i < end && i < j; i++) {
                    result.push($.extend({}, ko.unwrap(items)[i]));
                }

                dfd.resolve(result, ko.unwrap(items).length);
            }, 0);
            return dfd;
        });
    };
    ko.dtColumn = function (name, displayName) {
        var args;
        if (arguments.length === 2 || arguments.length === 1 && typeof (name) === 'string') {
            args = { name: name, displayName: displayName };
        } else {
            args = name;
        }

        return {
            data: propertyGetter,
            render: createTemplateFn(args.template, args.name),
            title: args.displayName || args.name,
            sortable: !!args.name
        };

        function propertyGetter(source, type) {
            if (type === 'display') {
                return args.name || '$data';
            } else if (type === 'filter' || type === 'sort') {
                return args.name;
            } else if (type === 'set') {
                return;
            } else {
                return function () { return source[args.name] || source; };
            }
        }

        function createTemplateFn(value, bindingField) {
            return function (source, type) {
                if (type === 'display') {
                    // HACK: To avoid unnecessary rendering in _fnCreateTr and increase performance don't return any result.
                    return '';
                } else {
                    return value || '<td data-bind="text: ' + (bindingField || '$data') + '"></td>';
                }
            };
        }
    };

    ko.bindingHandlers.datatables = {
        defaults: {
        },
        init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
            var $element = $(element),
                subscriptions = [],
                binding = $.extend({}, ko.bindingHandlers.datatables.defaults, valueAccessor()),
                options = mergeOptions(binding),
                scope = ko.utils.supressFeedbackScope();

            createRowTemplate(options.columnDefs);

            options.serverData = function (source, data) {
                scope.supressFeedback(function () {
                    var sortField = data.order && binding.columns[data.order[0].column].data(undefined, 'sort'),
                        sortOrder = data.order && data.order[0].dir;

                    binding.datasource.parameters.skip(data.start);
                    binding.datasource.parameters.top(data.length);
                    binding.datasource.parameters.sortField(sortField);
                    binding.datasource.parameters.sortOrder(sortOrder);
                    binding.datasource.fetch();
                });
            };
            options.rowCallback = function (row, srcData, displayIndex) {
                var itemContext = bindingContext.createChildContext(ko.unwrap(srcData), options['as']);
                itemContext['$index'] = ko.observable(displayIndex);
                row.innerHTML = '';
                ko.renderTemplate(binding.rowTemplate || element, itemContext, {}, row, 'replaceChildren');
                if (binding.rowCallback) {
                    binding.rowCallback(row, srcData);
                }

                return row;
            };

            $element.dataTable(options)
                .on('column-visibility.dt', onColumnDefinitionChanged)
                .on('column-reorder', onColumnDefinitionChanged);

            subscriptions.push(binding.datasource.result.items.subscribe(function (newItems) {
                var dataTable = $element.dataTable();
                var api = dataTable.api();

                var tableNodes = api.rows().nodes();
                if (tableNodes.length) {
                    // Unregister each of the table rows from knockout.
                    for (var i = 0, j = tableNodes.length; i < j; i++) {
                        ko.cleanNode(tableNodes[i]);
                    }
                }

                dataTable._fnAjaxUpdateDraw({
                    aaData: newItems,
                    iTotalRecords: binding.datasource.result.totalRows(),
                    iTotalDisplayRecords: binding.datasource.result.totalRows()
                });
                $element.trigger('reloaded');
            }));
            subscriptions.push(binding.datasource.parameters.skip.subscribe(function (newSkip) {
                scope.supressFeedback(function () {
                    var parameters = binding.datasource.parameters;
                    var api = $element.dataTable().api();
                    api.page(newSkip / parameters.top()).draw(false);
                });
            }));
            if (binding.loadingTemplate) {
                subscriptions.push(binding.datasource.fetchInProgress.subscribe(toggleLoading));
            }

            ko.utils.domNodeDisposal.addDisposeCallback(element, function () {
                for (var i = 0; i < subscriptions.length; i++) {
                    subscriptions[i].dispose();
                }
                $element.dataTable().api().destroy();
            });

            function getOrder(binding) {
                var field = binding.datasource.parameters.sortField();
                var order = binding.datasource.parameters.sortOrder();
                var fieldIndex = 0;
                for (var i = 0, j = binding.columns.length; i < j; i++) {
                    if (binding.columns[i].data(undefined, 'sort') === field) {
                        fieldIndex = i;
                        break;
                    }
                }
                return [fieldIndex, order];
            }

            function createRowTemplate(columns) {
                var $row = $('<tr>');

                ko.utils.arrayForEach(columns, function (column) {
                    if (column.bVisible !== false) {
                        $row.append(column.render());
                    }
                });

                var templateNodes = $row[0].childNodes,
                    container = moveCleanedNodesToContainerElement(templateNodes);
                new ko.templateSources.anonymousTemplate(element).nodes(container);
            }

            function buildDom(binding) {
                if (binding.dom) {
                    return binding.dom;
                }

                return (binding.allowColumnReorder === true ? 'R' : '') + 'Tti' + (binding.virtualScrolling === true ? 'S' : 'p');
            }

            function tableTools(binding) {
                var tableToolsSettings = {
                    aButtons: []
                },
                findRow = function (data) {
                    var index = binding.datasource.result.items.indexOf(data);
                    if (index !== -1) {
                        var tt = $.fn.dataTable.TableTools.fnGetInstance(element);
                        var row = element.rows[index + 1];
                        return row;
                    }
                },
                rowData = function (row) {
                    var td = row && row.cells[0];
                    return td && ko.dataFor(td);
                },
                resetSelected = function (items) {
                    if (binding.selected()) {
                        if (binding.selected.length) {

                        } else {
                            var key = ko.unwrap(binding.datasource.key),
                                selectedKey = ko.unwrap(binding.selected()[key]),
                                selected = ko.utils.arrayFirst(items, function (item) {
                                    return ko.unwrap(item[key]) === selectedKey;
                                });

                            if (selected) {
                                binding.selected(selected);
                            }
                        }
                    }
                },
                toggleRow = function (method) {
                    return function (elements) {
                        if (elements) {
                            setTimeout(function () {
                                var tt = $.fn.dataTable.TableTools.fnGetInstance(element);
                                var items = elements instanceof Array ? elements : [elements];
                                var rows = ko.utils.arrayMap(items, findRow);
                                var selectedRows = tt.fnGetSelected();
                                var rowsToToggle = [];
                                ko.utils.arrayForEach(rows, function (row) {
                                    if (row && (method === 'fnDeselect' || $(selectedRows).index(row) === -1)) {
                                        rowsToToggle.push(row);
                                    }
                                });
                                if (rowsToToggle.length > 0) {
                                    tt[method](rowsToToggle);
                                }
                            }, 0);
                        }
                    };
                },
                onRowKeyDown = function (e) {
                    if (e.keyCode === 40 || e.keyCode === 38) {
                        var $rows = $element.find('tbody tr');
                        var index = $rows.index(e.target);
                        var newIndex = index + (e.keyCode - 39);
                        if (newIndex >= 0 && newIndex <= $rows.length) {
                            var row = $rows.eq(newIndex)[0];
                            if (row) {
                                var tt = $.fn.dataTable.TableTools.fnGetInstance(element);
                                tt.fnSelect(row);
                            }
                            return false;
                        }
                    }
                },
                toggle;
                if (ko.isObservable(binding.selected)) {
                    if (binding.selected.push) {
                        toggle = function (operation) {
                            return function (nodes) {
                                var item = rowData(nodes[0]);
                                binding.selected[operation](item);
                            };
                        };

                        tableToolsSettings.sRowSelect = 'multi';
                        tableToolsSettings.fnRowDeselected = toggle('remove');
                        tableToolsSettings.fnRowSelected = toggle('push');
                    } else {
                        tableToolsSettings.sRowSelect = 'single';
                        tableToolsSettings.fnRowDeselected = function (nodes) {
                            if (binding.selected() && binding.selected() === rowData(nodes[0])) {
                                binding.selected(undefined);
                            }
                            if (binding.tabIndex) {
                                $(nodes[0]).removeAttr('tabindex').off('keydown', onRowKeyDown);
                            }
                        };
                        tableToolsSettings.fnRowSelected = function (nodes) {
                            var data = rowData(nodes[0]);
                            if (data !== binding.selected()) {
                                binding.selected(data);
                            }
                            if (binding.tabIndex) {
                                $(nodes[0]).attr('tabindex', binding.tabIndex).focus().on('keydown', onRowKeyDown);
                            }
                        };
                    }
                    subscriptions.push(binding.datasource.result.items.subscribe(resetSelected));
                    subscriptions.push(binding.selected.subscribe(toggleRow('fnDeselect'), null, 'beforeChange'));
                    subscriptions.push(binding.selected.subscribe(toggleRow('fnSelect')));
                    $element.on('reloaded', function () {
                        binding.selected.valueHasMutated();
                    });
                } else if (typeof binding.selected === 'string') {
                    toggle = function (value) {
                        return function (nodes) {
                            var items = nodes instanceof Array ? nodes : [nodes];
                            for (var i = 0; i < items.length; i++) {
                                var item = rowData(items[i]);
                                if (item) {
                                    item[binding.selected](value);
                                }
                            }
                        };
                    };

                    tableToolsSettings.sRowSelect = 'multi';
                    tableToolsSettings.fnRowSelected = toggle(true);
                    tableToolsSettings.fnRowDeselected = toggle(false);
                    subscriptions.push(binding.datasource.result.items.filter(function (item) { return item[binding.selected]() === true; }).subscribe(toggleRow('fnSelect')));
                    subscriptions.push(binding.datasource.result.items.filter(function (item) { return item[binding.selected]() === false; }).subscribe(toggleRow('fnDeselect')));
                }

                return tableToolsSettings;
            }

            function setupHeight(binding) {
                if (binding.scrollY) {
                    if (typeof binding.scrollY === 'function') {
                        var timeoutHandle;
                        var setScrollY = function () {
                            var $body = $element.parent();
                            var $wrapper = $element.parents('.dataTables_wrapper');
                            if ($wrapper.length > 0) {
                                var headerHeight = $wrapper.find('.dataTables_scrollHead').height();
                                var footerHeight = $wrapper.find('.dataTables_info').height();
                                $body.height($.proxy(binding.scrollY, $wrapper)() - headerHeight - footerHeight);
                                if (timeoutHandle) {
                                    clearTimeout(timeoutHandle);
                                }
                                timeoutHandle = setTimeout(function () {
                                    $element.dataTable().fnSettings().oScroller.fnMeasure(false);
                                }, 100);
                            }
                        },
                        container = $element.parents('body > *')[0];
                        $(window).resize(setScrollY);
                        window.addResizeListener(container, setScrollY);
                        ko.utils.domNodeDisposal.addDisposeCallback(element, function () {
                            window.removeResizeListener(container, setScrollY);
                        });
                        try {
                            return binding.scrollY() || 500;
                        }
                        catch (err) {
                            return 500;
                        }
                    } else {
                        return binding.scrollY;
                    }
                }
            }

            function onColumnDefinitionChanged(e, settings) {
                createRowTemplate(settings.aoColumns);
                $element.dataTable().api().draw(false);
            }

            function mergeOptions(binding) {
                var options = $.extend(
                    {},
                    binding,
                    {
                        columnDefs: $.each(binding.columns, function (i, val) { val.targets = [i]; }),
                        displayLength: binding.datasource.parameters.top(),
                        displayStart: binding.datasource.parameters.skip(),
                        serverSide: true,
                        dom: buildDom(binding),
                        deferRender: binding.deferRender || binding.virtualScrolling,
                        order: binding.order || getOrder(binding),
                        scrollY: setupHeight(binding),
                        oTableTools: tableTools(binding),
                        initComplete: function (o) {
                            if (binding.virtualScrolling) {
                                o.oScroller.fnScrollToRow(binding.datasource.parameters.skip());
                            }
                        }
                    });

                delete options.datasource;
                delete options.columns;
                delete options.virtualScrolling;
                delete options.selected;
                delete options.loadingTemplate;
                return options;
            }

            function toggleLoading(toggle) {
                var id = $element.parents('.dataTables_wrapper')[0].id.replace('wrapper', 'loader');
                var $loader = $(document.getElementById(id));
                if (toggle) {
                    var $parent = $element.parent();
                    if (!$loader.length) {
                        var tmpl = document.getElementById(binding.loadingTemplate);
                        $loader = $(tmpl.innerHTML).attr({ id: id }).css({position: 'absolute', 'z-index': 1, left: 0, right: 0 });
                        $parent.append($loader);
                    }

                    var scrollTop = $parent.scrollTop();
                    var height = $parent.height();
                    $loader.css({ top: scrollTop, height: height }).show();
                } else {
                    $loader.hide();
                }
            }

            function moveCleanedNodesToContainerElement(nodes) {
                // Ensure it's a real array, as we're about to reparent the nodes and
                // we don't want the underlying collection to change while we're doing that.
                var nodesArray = makeArray(nodes);

                var container = document.createElement('div');
                for (var i = 0, j = nodesArray.length; i < j; i++) {
                    container.appendChild(ko.cleanNode(nodesArray[i]));
                }
                return container;
            }

            function makeArray(arrayLikeObject) {
                var result = [];
                for (var i = 0, j = arrayLikeObject.length; i < j; i++) {
                    result.push(arrayLikeObject[i]);
                }
                return result;
            }
        }
    };

    ko.utils.supressFeedbackScope = function () {
        var supressFeedback = false;
        return {
            supressFeedback: function (callback) {
                if (!supressFeedback) {
                    supressFeedback = true;
                    try {
                        callback();
                    }
                    finally {
                        supressFeedback = false;
                    }
                }
            }
        };
    };

    (function () {

        var attachEvent = document.attachEvent;

        if (!attachEvent) {
            var requestFrame = (function () {
                var raf = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame ||
                          function (fn) { return window.setTimeout(fn, 20); };
                return function (fn) { return raf(fn); };
            })();

            var cancelFrame = (function () {
                var cancel = window.cancelAnimationFrame || window.mozCancelAnimationFrame || window.webkitCancelAnimationFrame ||
                             window.clearTimeout;
                return function (id) { return cancel(id); };
            })();
        }

        window.addResizeListener = function (element, fn) {
            if (attachEvent) {
                element.attachEvent('resize', fn);
            } else {
                if (!element.__resizeTriggers__) {
                    if (getComputedStyle(element).position == 'static') {
                        element.style.position = 'relative';
                    }
                    element.__resizeLast__ = {};
                    element.__resizeListeners__ = [];
                    (element.__resizeTriggers__ = document.createElement('div')).className = 'resize-triggers';
                    element.__resizeTriggers__.innerHTML = '<div class="expand-trigger"><div></div></div>' +
                                                           '<div class="contract-trigger"></div>';
                    element.appendChild(element.__resizeTriggers__);
                    resetTriggers(element);
                    element.addEventListener('scroll', scrollListener, true);
                }
                element.__resizeListeners__.push(fn);
            }
        };

        window.removeResizeListener = function (element, fn) {
            if (attachEvent) {
                element.detachEvent('resize', fn);
            } else {
                element.__resizeListeners__.splice(element.__resizeListeners__.indexOf(fn), 1);
                if (!element.__resizeListeners__.length) {
                    element.removeEventListener('scroll', scrollListener);
                    if (element.__resizeTriggers__) {
                        element.__resizeTriggers__ = !element.removeChild(element.__resizeTriggers__);
                    }
                }
            }
        };

        $('head').append('<style>.resize-triggers{opacity:0;visibility:hidden;}.resize-triggers,.resize-triggers>div,.contract-trigger:before{content:" ";display:block;position:absolute;top:0;left:0;height:100%;width:100%;overflow:hidden;}.resize-triggers>div{background:#eee;overflow:auto;}.contract-trigger:before{width:200%;height:200%;}</style>');

        function resetTriggers(element) {
            var triggers = element.__resizeTriggers__,
                expand = triggers.firstElementChild,
                contract = triggers.lastElementChild,
                expandChild = expand.firstElementChild;
            contract.scrollLeft = contract.scrollWidth;
            contract.scrollTop = contract.scrollHeight;
            expandChild.style.width = expand.offsetWidth + 1 + 'px';
            expandChild.style.height = expand.offsetHeight + 1 + 'px';
            expand.scrollLeft = expand.scrollWidth;
            expand.scrollTop = expand.scrollHeight;
        }

        function checkTriggers(element) {
            return element.offsetWidth != element.__resizeLast__.width ||
                   element.offsetHeight != element.__resizeLast__.height;
        }

        function scrollListener(e) {
            var element = this;
            resetTriggers(this);
            if (this.__resizeRAF__) {
                cancelFrame(this.__resizeRAF__);
            }
            this.__resizeRAF__ = requestFrame(function () {
                if (checkTriggers(element)) {
                    element.__resizeLast__.width = element.offsetWidth;
                    element.__resizeLast__.height = element.offsetHeight;
                    element.__resizeListeners__.forEach(function (fn) {
                        fn.call(element, e);
                    });
                }
            });
        }

    })();

})(window.$, window.ko);