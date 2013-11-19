knockout.datatables
===================

* `columns` - definicja kolumn
* `datasource` - provides grid model which manage data source. You can use the following data sources:

	* `ko.gridModel.inMemory` - grid model that use in memory data,
	* `ko.gridModel.odata` - grid model that use OData service to load server-side data,
	* you can just use `ko.gridModel(requestCallback)` to create your own grid model.

* `scrollY` - enable scroll mode in grid
* `virtualScrolling` - enable virtual scroll mode