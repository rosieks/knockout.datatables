knockout.datatables
===================

* `columns` - columns definition
* `datasource` - provides grid model which manage data source. You can use the following data sources:

	* `ko.gridModel.inMemory` - grid model that use in memory data,
	* `ko.gridModel.odata` - grid model that use OData service to load server-side data,
	* you can just use `ko.gridModel(requestCallback)` to create your own grid model.

* `deferRender` - ???
* `dom` - ???
* `rowCallback` - ???
* `rowTemplate` - ???
* `selected` - observable, observableArray or item property name indicating if it is selected
* `scrollY` - enable scroll mode in grid
* `tabIndex` - ???
* `virtualScrolling` - enable virtual scroll mode