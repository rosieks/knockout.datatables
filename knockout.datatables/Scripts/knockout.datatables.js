// Knockout DataTables 0.1.0
// (c) Sławomir Rosiek - https://github.com/rosieks/knockout.datatables
// License: MIT (http://www.opensource.org/licenses/mit-license.php)

/* jshint -W069 */

(function ($, ko) {
    ko.gridModel = function (requestData) {
        var page = ko.observable(1),
            pageSize = ko.observable(20).extend({ throttle: 0 }),
            sortField = ko.observable().extend({ throttle: 0 }),
            sortOrder = ko.observable('ASC').extend({ throttle: 0 }),
            totalRows = ko.observable(),
            items = ko.observableArray(),
            timeoutHandle;

        var model = {
            page: page,
            pageSize: pageSize,
            sortField: sortField,
            sortOrder: sortOrder,
            totalRows: totalRows,
            items: items,
            load: load,
            store: store,
            fetch: _requestData
        };

        _subscribe();

        return model;

        function _requestData(changedValue) {
            clearTimeout(timeoutHandle);
            timeoutHandle = setTimeout(function () {
                console.log('Request ' + model.pageSize() + 'rows');
                console.trace();
                requestData(model, changedValue).done(function (items, totalRows) {
                    model.totalRows(totalRows);
                    model.items(items);
                });
            }, 0);
        }

        function _subscribe() {
            var fields = ['page', 'pageSize', 'sortField', 'sortOrder'];
            var requestData = function (field) {
                return function (newValue) {
                    _requestData({ field: field, newValue: newValue });
                };
            };
            for (var i = 0, j = fields.length; i < j; i++) {
                var field = fields[i];
                model[field].subscribe(requestData(field));
            }
        }

        function load(name) {

        }

        function store(name) {

        }
    };
    ko.gridModel.inMemory = function (items) {
        return ko.gridModel(function (model, changedValue) {
            var dfd = $.Deferred();

            setTimeout(function () {
                var start = parseInt(model.pageSize() * (model.page() - 1)),
                    end = parseInt(model.pageSize() * model.page()),
                    result = [];

                if (!changedValue || (changedValue.field === 'sortField' || changedValue.field === 'sortOrder')) {
                    var sortField = model.sortField();
                    var sortMultiplier = model.sortOrder() === 'asc' ? -1 : 1;
                    items.sort(function (i, j) {

                        if (ko.unwrap(i[sortField]) < ko.unwrap(j[sortField])) {
                            return sortMultiplier;
                        }
                        else if (ko.unwrap(i[sortField]) > ko.unwrap(j[sortField])) {
                            return -sortMultiplier;
                        }
                        else {
                            return 0;
                        }
                    });
                }

                for (var i = start; i < end && i < items.length; i++) {
                    result.push(items[i]);
                }

                dfd.resolve(result, items.length);
            }, 0);
            return dfd;
        });
    };
    ko.dtColumn = function (name, displayName) {
        var args;
        if (arguments.length === 2 || arguments.length === 1 && typeof (name) === 'string') {
            args = { name: name, displayName: displayName };
        }
        else {
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
            }
            else if (type === 'filter' || type === 'sort') {
                return args.name;
            }
            else if (type === 'set') {
                return;
            }
            else {
                return function () { return source[args.name] || source; };
            }
        }

        function createTemplateFn(value, bindingField) {
            return function (source, type) {
                if (type === 'display') {
                    // HACK: To avoid unnecessary rendering in _fnCreateTr and increase performance don't return any result.
                    return '';
                }
                else {
                    return value || '<td data-bind="text: ' + (bindingField || '$data') + '"></td>';
                }
            };
        }
    };

    ko.bindingHandlers.datatables = {
        init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
            var binding = valueAccessor();
            var options = {
                columnDefs: $.each(binding.columns, function (i, val) { val.targets = [i]; }),
                displayLength: binding.datasource.pageSize(),
                displayStart: binding.datasource.pageSize() * (binding.datasource.page() - 1),
                serverSide: true,
                dom: buildDom(binding),
                deferRender: binding.deferRender || binding.virtualScrolling,
                scrollY: setupHeight(binding),
                oTableTools: tableTools(binding)
            },
            scope = ko.utils.supressFeedbackScope();

            createRowTemplate(options.columnDefs);

            options.serverData = function (source, data) {
                scope.supressFeedback(function () {
                    var start = data.start,
                        pageSize = data.length,
                        page = start / pageSize + 1,
                        sortField = binding.columns[data.order[0].column].data(undefined, 'sort'),
                        sortOrder = data.order[0].dir;

                    binding.datasource.page(page);
                    binding.datasource.pageSize(pageSize);
                    binding.datasource.sortField(sortField);
                    binding.datasource.sortOrder(sortOrder);
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

            $(element).dataTable(options).on('column-reorder', onColumnReorder);

            binding.datasource.items.subscribe(function (newItems) {
                var dataTable = $(element).dataTable();
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
                    iTotalRecords: binding.datasource.totalRows(),
                    iTotalDisplayRecords: binding.datasource.totalRows()
                });
                $(element).trigger('reloaded');
            });

            binding.datasource.page.subscribe(function (newPage) {
                scope.supressFeedback(function () {
                    var api = $(element).dataTable().api();
                    api.page(newPage).draw(false);
                });
            });

            function createRowTemplate(columns) {
                var row = $('<tr>');

                ko.utils.arrayForEach(columns, function (column) {
                    row.append(column.render());
                });

                var templateNodes = row[0].childNodes,
                    container = ko.utils.moveCleanedNodesToContainerElement(templateNodes);
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
                    var index = binding.datasource.items.indexOf(data);
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
                        var rows = $(element).find('tbody tr');
                        var index = rows.index(e.target);
                        var newIndex = index + (e.keyCode - 39);
                        if (newIndex >= 0 && newIndex <= rows.length) {
                            var row = rows.eq(newIndex)[0];
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
                    }
                    else {
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
                    binding.selected.subscribe(toggleRow('fnDeselect'), null, 'beforeChange');
                    binding.selected.subscribe(toggleRow('fnSelect'));
                    $(element).on('reloaded', function () {
                        binding.selected.valueHasMutated();
                    });
                }
                else if (typeof binding.selected === 'string') {
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
                    binding.datasource.items.filter(function (item) { return item[binding.selected]() === true; }).subscribe(toggleRow('fnSelect'));
                    binding.datasource.items.filter(function (item) { return item[binding.selected]() === false; }).subscribe(toggleRow('fnDeselect'));
                }

                return tableToolsSettings;
            }

            function setupHeight(binding) {
                if (binding.scrollY) {
                    if (typeof binding.scrollY === 'function') {
                        var setScrollY = function () {
                            var body = $(element).parent();
                            if (body.length > 0) {
                                body.height($.proxy(binding.scrollY, body)());
                            }
                        };
                        $(window).resize(setScrollY);
                        setTimeout(function () {
                            $(element).dataTable()._fnAdjustColumnSizing(true);
                            setScrollY();
                        }, 100);
                        try {
                            return binding.scrollY() || 500;
                        }
                        catch (err) {
                            return 500;
                        }
                    }
                    else {
                        return binding.scrollY;
                    }
                }
            }

            function onColumnReorder(a, b, c) {
                //createRowTemplate()
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

})(window.$, window.ko);