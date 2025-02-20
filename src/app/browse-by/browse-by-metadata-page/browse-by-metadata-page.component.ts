import { combineLatest as observableCombineLatest, Observable, Subscription } from 'rxjs';
import { Component, OnInit } from '@angular/core';
import { RemoteData } from '../../core/data/remote-data';
import { PaginatedList } from '../../core/data/paginated-list.model';
import { PaginationComponentOptions } from '../../shared/pagination/pagination-component-options.model';
import { SortDirection, SortOptions } from '../../core/cache/models/sort-options.model';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { hasValue, isNotEmpty } from '../../shared/empty.util';
import { BrowseService } from '../../core/browse/browse.service';
import { BrowseEntry } from '../../core/shared/browse-entry.model';
import { Item } from '../../core/shared/item.model';
import { BrowseEntrySearchOptions } from '../../core/browse/browse-entry-search-options.model';
import { getFirstSucceededRemoteData } from '../../core/shared/operators';
import { DSpaceObjectDataService } from '../../core/data/dspace-object-data.service';
import { DSpaceObject } from '../../core/shared/dspace-object.model';
import { StartsWithType } from '../../shared/starts-with/starts-with-decorator';
import { BrowseByDataType, rendersBrowseBy } from '../browse-by-switcher/browse-by-decorator';
import { PaginationService } from '../../core/pagination/pagination.service';
import { map } from 'rxjs/operators';

export const BBM_PAGINATION_ID = 'bbm';

@Component({
  selector: 'ds-browse-by-metadata-page',
  styleUrls: ['./browse-by-metadata-page.component.scss'],
  templateUrl: './browse-by-metadata-page.component.html'
})
/**
 * Component for browsing (items) by metadata definition
 * A metadata definition (a.k.a. browse id) is a short term used to describe one or multiple metadata fields.
 * An example would be 'author' for 'dc.contributor.*'
 */
@rendersBrowseBy(BrowseByDataType.Metadata)
export class BrowseByMetadataPageComponent implements OnInit {

  /**
   * The list of browse-entries to display
   */
  browseEntries$: Observable<RemoteData<PaginatedList<BrowseEntry>>>;

  /**
   * The list of items to display when a value is present
   */
  items$: Observable<RemoteData<PaginatedList<Item>>>;

  /**
   * The current Community or Collection we're browsing metadata/items in
   */
  parent$: Observable<RemoteData<DSpaceObject>>;

  /**
   * The pagination config used to display the values
   */
  paginationConfig: PaginationComponentOptions = Object.assign(new PaginationComponentOptions(), {
    id: BBM_PAGINATION_ID,
    currentPage: 1,
    pageSize: 20
  });

  /**
   * The pagination observable
   */
  currentPagination$: Observable<PaginationComponentOptions>;

  /**
   * The sorting config observable
   */
  currentSort$: Observable<SortOptions>;

  /**
   * List of subscriptions
   */
  subs: Subscription[] = [];

  /**
   * The default browse id to resort to when none is provided
   */
  defaultBrowseId = 'author';

  /**
   * The current browse id
   */
  browseId = this.defaultBrowseId;

  /**
   * The type of StartsWith options to render
   * Defaults to text
   */
  startsWithType = StartsWithType.text;

  /**
   * The list of StartsWith options
   * Should be defined after ngOnInit is called!
   */
  startsWithOptions;

  /**
   * The value we're browing items for
   * - When the value is not empty, we're browsing items
   * - When the value is empty, we're browsing browse-entries (values for the given metadata definition)
   */
  value = '';

  /**
   * The authority key (may be undefined) associated with {@link #value}.
   */
   authority: string;

  /**
   * The current startsWith option (fetched and updated from query-params)
   */
  startsWith: string;

  public constructor(protected route: ActivatedRoute,
                     protected browseService: BrowseService,
                     protected dsoService: DSpaceObjectDataService,
                     protected paginationService: PaginationService,
                     protected router: Router) {
  }

  ngOnInit(): void {
    const sortConfig = new SortOptions('default', SortDirection.ASC);
    this.updatePage(new BrowseEntrySearchOptions(this.defaultBrowseId, this.paginationConfig, sortConfig));
    this.currentPagination$ = this.paginationService.getCurrentPagination(this.paginationConfig.id, this.paginationConfig);
    this.currentSort$ = this.paginationService.getCurrentSort(this.paginationConfig.id, sortConfig);
    this.subs.push(
      observableCombineLatest([this.route.params, this.route.queryParams, this.currentPagination$, this.currentSort$]).pipe(
        map(([routeParams, queryParams, currentPage, currentSort]) => {
          return [Object.assign({}, routeParams, queryParams),currentPage,currentSort];
        })
      ).subscribe(([params, currentPage, currentSort]: [Params, PaginationComponentOptions, SortOptions]) => {
          this.browseId = params.id || this.defaultBrowseId;
          this.authority = params.authority;
          this.value = +params.value || params.value || '';
          this.startsWith = +params.startsWith || params.startsWith;
          const searchOptions = browseParamsToOptions(params, currentPage, currentSort, this.browseId);
          if (isNotEmpty(this.value)) {
            this.updatePageWithItems(searchOptions, this.value, this.authority);
          } else {
            this.updatePage(searchOptions);
          }
          this.updateParent(params.scope);
        }));
    this.updateStartsWithTextOptions();
  }

  /**
   * Update the StartsWith options with text values
   * It adds the value "0-9" as well as all letters from A to Z
   */
  updateStartsWithTextOptions() {
    this.startsWithOptions = ['0-9', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  }

  /**
   * Updates the current page with searchOptions
   * @param searchOptions   Options to narrow down your search:
   *                        { metadata: string
   *                          pagination: PaginationComponentOptions,
   *                          sort: SortOptions,
   *                          scope: string }
   */
  updatePage(searchOptions: BrowseEntrySearchOptions) {
    this.browseEntries$ = this.browseService.getBrowseEntriesFor(searchOptions);
    this.items$ = undefined;
  }

  /**
   * Updates the current page with searchOptions and display items linked to the given value
   * @param searchOptions   Options to narrow down your search:
   *                        { metadata: string
   *                          pagination: PaginationComponentOptions,
   *                          sort: SortOptions,
   *                          scope: string }
   * @param value          The value of the browse-entry to display items for
   */
  updatePageWithItems(searchOptions: BrowseEntrySearchOptions, value: string, authority: string) {
    this.items$ = this.browseService.getBrowseItemsFor(value, authority, searchOptions);
  }

  /**
   * Update the parent Community or Collection using their scope
   * @param scope   The UUID of the Community or Collection to fetch
   */
  updateParent(scope: string) {
    if (hasValue(scope)) {
      this.parent$ = this.dsoService.findById(scope).pipe(
        getFirstSucceededRemoteData()
      );
    }
  }

  /**
   * Navigate to the previous page
   */
  goPrev() {
    if (this.items$) {
      this.items$.pipe(getFirstSucceededRemoteData()).subscribe((items) => {
        this.items$ = this.browseService.getPrevBrowseItems(items);
      });
    } else if (this.browseEntries$) {
      this.browseEntries$.pipe(getFirstSucceededRemoteData()).subscribe((entries) => {
        this.browseEntries$ = this.browseService.getPrevBrowseEntries(entries);
      });
    }
  }

  /**
   * Navigate to the next page
   */
  goNext() {
    if (this.items$) {
      this.items$.pipe(getFirstSucceededRemoteData()).subscribe((items) => {
        this.items$ = this.browseService.getNextBrowseItems(items);
      });
    } else if (this.browseEntries$) {
      this.browseEntries$.pipe(getFirstSucceededRemoteData()).subscribe((entries) => {
        this.browseEntries$ = this.browseService.getNextBrowseEntries(entries);
      });
    }
  }

  ngOnDestroy(): void {
    this.subs.filter((sub) => hasValue(sub)).forEach((sub) => sub.unsubscribe());
    this.paginationService.clearPagination(this.paginationConfig.id);
  }


}

/**
 * Function to transform query and url parameters into searchOptions used to fetch browse entries or items
 * @param params            URL and query parameters
 * @param paginationConfig  Pagination configuration
 * @param sortConfig        Sorting configuration
 * @param metadata          Optional metadata definition to fetch browse entries/items for
 */
export function browseParamsToOptions(params: any,
                                      paginationConfig: PaginationComponentOptions,
                                      sortConfig: SortOptions,
                                      metadata?: string): BrowseEntrySearchOptions {
  return new BrowseEntrySearchOptions(
    metadata,
    paginationConfig,
    sortConfig,
    +params.startsWith || params.startsWith,
    params.scope
  );
}
