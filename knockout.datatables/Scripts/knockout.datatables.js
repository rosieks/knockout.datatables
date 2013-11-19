/* jshint -W069 */

(function ($, ko) {
    ko.gridModel = function (requestData) {
        var page = ko.observable(1),
            pageSize = ko.observable(20).extend({ throttle: 0 }),
            sortField = ko.observable().extend({ throttle: 0 }),
            sortOrder = ko.observable('ASC').extend({ throttle: 0 }),
            totalRows = ko.observable(),
            items = ko.observableArray();

        var model = {
            page: page,
            pageSize: pageSize,
            sortField: sortField,
            sortOrder: sortOrder,
            totalRows: totalRows,
            items: items
        };

        _subscribe();
        _requestData();

        return model;

        function _requestData() {
            console.log('Request ' + model.pageSize() + 'rows');
            requestData(model).done(function (items, totalRows) {
                model.totalRows(totalRows);
                model.items(items);
            });
        }

        function _subscribe() {
            var fields = ['page', 'pageSize', 'sortField', 'sortOrder'];
            for (var i = 0, j = fields.length; i < j; i++) {
                model[fields[i]].subscribe(_requestData);
            }
        }
    };
    ko.gridModel.inMemory = function (items) {
        return ko.gridModel(function (model) {
            var dfd = $.Deferred();

            setTimeout(function () {
                var start = parseInt(model.pageSize() * (model.page() - 1)),
                    end = parseInt(model.pageSize() * model.page()),
                    result = [];

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
            return function () {
                return value || '<td data-bind="text: ' + (bindingField || '$data') + '"></td>';
            };
        }
    };

    ko.bindingHandlers.datatables = {
        init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
            var binding = valueAccessor();
            var options = {
                columnDefs: $.each(binding.columns, function (i, val) { val.aTargets = [i]; }),
                displayLength: binding.datasource.pageSize(),
                displayStart: binding.datasource.pageSize() * (binding.datasource.page() - 1),
                serverSide: true,
                dom: buildDom(binding),
                deferRender: binding.deferRender || binding.virtualScrolling,
                oScroller: binding.virtualScrolling && { loadingIndicator: true },
                scrollY: setupHeight(binding)
            };

            createRowTemplate(options.columnDefs);

            options.serverData = function (source, data) {
                var start = data.start,
                    pageSize = data.length,
                    page = start / pageSize + 1,
                    sortField = binding.columns[data.sort[0].column].data(undefined, 'sort'),
                    sortOrder = data.sort[0].dir;

                binding.datasource.page(page);
                binding.datasource.pageSize(pageSize);
                binding.datasource.sortField(sortField);
                binding.datasource.sortOrder(sortOrder);
            };
            options.rowCallback = function (row, srcData, displayIndex) {
                var itemContext = bindingContext.createChildContext(ko.unwrap(srcData), options['as']);
                itemContext['$index'] = ko.observable(displayIndex);
                ko.renderTemplate(binding.rowTemplate || element, itemContext, {}, row, 'replaceChildren');
                if (binding.rowCallback) {
                    binding.rowCallback(row, srcData);
                }

                if (ko.isObservable(binding.selectedRow)) {
                    $(row).click(function () {
                        binding.selectedRow(srcData);
                    });
                }

                return row;
            };
            if (binding.group) {
                options.drawCallback = function () {
                    var api = this.api(),
                        rows = api.rows({ page: 'current' }).nodes(),
                        last = null;

                    api.data().each(function (item, i) {
                        var val = ko.unwrap(item[binding.group]);
                        if (last !== val) {
                            var collapseButton = '<span class="glyphicon glyphicon-chevron-up"></span>';
                            $(rows).eq(i).before('<tr class="group"><td colspan="' + api.columns().data().length + '">' + collapseButton + val + '</td></tr>');
                            last = val;
                        }
                    });
                };
            }

            $(element).dataTable(options);

            binding.datasource.items.subscribe(function (newItems) {
                var dataTable = $(element).dataTable();
                var api = dataTable.api();

                var tableNodes = api.rows().nodes();
                if (tableNodes.length) {
                    // Unregister each of the table rows from knockout.
                    ko.utils.arrayForEach(tableNodes, function (node) { ko.cleanNode(node); });
                }

                dataTable._fnAjaxUpdateDraw({
                    aaData: newItems,
                    iTotalRecords: binding.datasource.totalRows(),
                    iTotalDisplayRecords: binding.datasource.totalRows()
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

                return 'ti' + (binding.virtualScrolling === true ? 'S' : 'p');
            }

            function setupHeight(binding) {
                if (binding.scrollY) {
                    if (typeof binding.scrollY === 'function') {
                        var setScrollY = function () {
                            var body = $(element).find('.dataTables_scrollBody');
                            body.height($.proxy(binding.scrollY, body)());
                        };
                        $(window).resize(setScrollY);
                        setTimeout(setScrollY, 0);
                        return binding.scrollY();
                    }
                    else {
                        return binding.scrollY;
                    }
                }
            }
        }
    };
})($, window.ko);