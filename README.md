# Datagroom `v0.5`

Datagroom aims to provide tools to maintain and groom arbitrary datasets with a simple and intuitive user-experience. The data grooming can be done by multiple users simultaneously. 

* `datagroom-gateway`: This constitutes the backend of datagroom. 

* `datagroom-ui`: Constitutes the react front-end for it. 

## Features

1. The data is stored in `MongoDb` at the backend. 

1. The front-end features the wonderful `Tabulator` (tabulator.info) component. 

1. Shared editing of data with similar user-experience like a Google sheet. 
    * Per-cell locking.
    * Dynamic updates to edited cells. 
    * Guaranteed to not overwrite a more recent edit by someone else. 

1. Supports markdown in cells. You edit markdown and the html is rendered in the table. 

1. Export of all data to `xlsx` file format. 

1. Paging, Filtering, Searching (regex), Sorting of data. All from the backend, enabling the tool to work with very large datasets. 

1. Import your data from `xlsx`. 

1. Adjust and set views that is visible for everyone. 

1. Easy copy of rendered HTML to clipboard. 

## Screenshots

1. A sample table once populated:
![](./img/2020-09-19-16-13-20.png)

1. Markdown editing in progress
![](./img/2020-09-19-16-16-44.png)

1. Markdown rendered once editing is done
![](./img/2020-09-19-16-17-42.png)

1. 


