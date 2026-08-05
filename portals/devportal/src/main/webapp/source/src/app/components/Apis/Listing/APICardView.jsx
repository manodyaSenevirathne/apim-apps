/*
 * Copyright (c) 2019, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
 *
 * WSO2 Inc. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import React from 'react';
import { styled } from '@mui/material/styles';
import PropTypes from 'prop-types';
import MUIDataTable from 'mui-datatables';
import { injectIntl } from 'react-intl';
import API from 'AppData/api';
import Subscription from 'AppData/Subscription';
import CONSTANTS from 'AppData/Constants';
import NoApi from 'AppComponents/Apis/Listing/NoApi';
import Loading from 'AppComponents/Base/Loading/Loading';
import Alert from 'AppComponents/Shared/Alert';
import ResourceNotFound from '../../Base/Errors/ResourceNotFound';
import SubscriptionPolicySelect from './SubscriptionPolicySelect';

const PREFIX = 'APICardView';

const classes = {
    root: `${PREFIX}-root`,
    buttonGap: `${PREFIX}-buttonGap`,
};

const Root = styled('div')(() => ({
    [`& .${classes.root}`]: {
        display: 'flex',
    },

    [`& .${classes.buttonGap}`]: {
        marginRight: 10,
    },

    '[dir="rtl"] & [class*="MUIDataTable-responsiveStacked"]': {
        overflowX: 'hidden',
    },
}));

/**
 * @class APICardView
 * @param {number} page page number
 * @extends {React.Component}
 */
class APICardView extends React.Component {
    /**
     * @param {JSON} props properties passed from parent
     */
    constructor(props) {
        super(props);
        this.state = {
            data: null,
            loading: true,
        };
        this.page = 0;
        this.count = 0;
        this.rowsPerPage = 10;
        this.pageType = null;
        this.visibleAPIs = [];
        this.apiOffset = 0;
        this.apiTotal = null;
        this.allAPIsLoaded = false;
        this.apiLoadRequestId = 0;
        this.mounted = false;
    }

    /**
     * component mount callback
     */
    componentDidMount() {
        this.mounted = true;
        this.getData();
    }

    /**
     * component unmount callback
     */
    componentWillUnmount() {
        this.mounted = false;
        this.apiLoadRequestId++;
    }

    /**
     * @param {JSON} prevProps props from previous component instance
     */
    componentDidUpdate(prevProps) {
        const { refreshKey, searchText } = this.props;
        if (refreshKey !== prevProps.refreshKey) {
            this.resetAPICache();
            this.setState({ loading: true });
            this.getData();
        } else if (searchText !== prevProps.searchText) {
            this.page = 0;
            this.resetAPICache();
            this.setState({ loading: true });
            this.getData();
        }
    }

    // get data
    getData = () => {
        const { intl } = this.props;
        const requestId = this.apiLoadRequestId;
        this.loadPage(this.page, requestId)
            .then((data) => {
                if (this.mounted && requestId === this.apiLoadRequestId) {
                    this.setState({ data });
                }
            })
            .catch((error) => {
                if (!this.mounted || requestId !== this.apiLoadRequestId) {
                    return;
                }
                const { response } = error;
                const { setTenantDomain } = this.props;
                if (response && response.body.code === 901300) {
                    setTenantDomain('INVALID');
                    Alert.error(intl.formatMessage({
                        defaultMessage: 'Invalid tenant domain',
                        id: 'Apis.Listing.ApiTableView.invalid.tenant.domain',
                    }));
                } else {
                    Alert.error(intl.formatMessage({
                        defaultMessage: 'Error While Loading APIs',
                        id: 'Apis.Listing.ApiTableView.error.loading',
                    }));
                }
            })
            .finally(() => {
                if (this.mounted && requestId === this.apiLoadRequestId) {
                    this.setState({ loading: false });
                }
            });
    };

    /**
    * Resolve which APIs in the given page are already subscribed by this application.
    * Queries the subscriptions endpoint with both apiId and applicationId so the backend
    * returns only the matching subscription per API.
    *
    * @param {Array} list a page of APIs
    * @returns {Promise<Set<string>>} ids of the APIs in this page that are already subscribed
    * @memberof APICardView
    */
    resolveSubscribedIds = (list) => {
        const { applicationId } = this.props;
        const subscribedIds = new Set();
        if (!applicationId || !list || list.length === 0) {
            return Promise.resolve(subscribedIds);
        }
        const client = new Subscription();
        return Promise.all(list.map((api) => client.getSubscriptions(api.id, applicationId, 1, 0, 'ALL')
            .then((response) => {
                const subList = (response && response.body && response.body.list) || [];
                if (subList.length > 0) {
                    subscribedIds.add(api.id);
                }
            })
            .catch(() => {})))
            .then(() => subscribedIds);
    };

    changePage = (page) => {
        const { intl } = this.props;
        const requestId = this.apiLoadRequestId;
        this.page = page;
        this.setState({ loading: true });
        this.loadPage(page, requestId)
            .then((data) => {
                if (this.mounted && requestId === this.apiLoadRequestId) {
                    this.setState({ data });
                }
            })
            .catch(() => {
                if (!this.mounted || requestId !== this.apiLoadRequestId) {
                    return;
                }
                Alert.error(intl.formatMessage({
                    defaultMessage: 'Error While Loading APIs',
                    id: 'Apis.Listing.ApiTableView.error.loading',
                }));
            })
            .finally(() => {
                if (this.mounted && requestId === this.apiLoadRequestId) {
                    this.setState({ loading: false });
                }
            });
    };

    /**
     * Reset APIs collected for the current search and subscription state.
     */
    resetAPICache = () => {
        this.visibleAPIs = [];
        this.apiOffset = 0;
        this.apiTotal = null;
        this.allAPIsLoaded = false;
        this.count = 0;
        this.apiLoadRequestId++;
    };

    /**
     * Load enough backend pages to fill the requested visible page.
     * @param {number} page requested UI page
     * @param {number} requestId current load request id
     * @returns {Promise<Array>} APIs for the requested page
     */
    loadPage = (page, requestId) => {
        const requiredVisibleAPIs = ((page + 1) * this.rowsPerPage) + 1;

        return this.loadUntil(requiredVisibleAPIs, requestId)
            .then(() => {
                const start = page * this.rowsPerPage;
                return this.visibleAPIs.slice(start, start + this.rowsPerPage);
            });
    };

    /**
     * Continue loading backend pages until enough visible APIs are available.
     * @param {number} requiredVisibleAPIs number of visible APIs required
     * @param {number} requestId current load request id
     * @returns {Promise<void>}
     */
    loadUntil = (requiredVisibleAPIs, requestId) => {
        if (requestId !== this.apiLoadRequestId) {
            return Promise.resolve();
        }
        if (this.visibleAPIs.length >= requiredVisibleAPIs || this.allAPIsLoaded) {
            this.updateAPICount();
            return Promise.resolve();
        }

        const { searchText } = this.props;
        const api = new API();
        const query = searchText && searchText !== ''
            ? `${searchText} status:published` : 'status:published';

        return api.getAllAPIs({ query, limit: this.rowsPerPage, offset: this.apiOffset })
            .then((response) => {
                if (requestId !== this.apiLoadRequestId) {
                    return null;
                }
                const { body } = response;
                const { list = [], pagination = {} } = body;
                const limit = pagination.limit ?? this.rowsPerPage;
                const offset = pagination.offset ?? this.apiOffset;

                this.apiTotal = pagination.total ?? this.apiTotal ?? list.length;
                this.apiOffset = offset + limit;

                return this.resolveSubscribedIds(list).then((subscribedIds) => {
                    if (requestId !== this.apiLoadRequestId) {
                        return null;
                    }
                    this.visibleAPIs = this.visibleAPIs
                        .concat(this.updateUnsubscribedAPIsList(list, subscribedIds));
                    this.allAPIsLoaded = list.length === 0 || this.apiOffset >= this.apiTotal;

                    if (this.visibleAPIs.length < requiredVisibleAPIs && !this.allAPIsLoaded) {
                        return this.loadUntil(requiredVisibleAPIs, requestId);
                    }
                    this.updateAPICount();
                    return null;
                });
            });
    };

    /**
     * Use the visible APIs loaded so far as the paginator count.
     */
    updateAPICount = () => {
        this.count = this.visibleAPIs.length;
    };

    /**
    * Update list of unsubscribed APIs
    * @param {Array} list array of apis
    * @param {Set<string>} subscribedIds ids of APIs in this page that are already subscribed
    * @returns {Array} filtered list of apis
    * @memberof APICardView
    */
    updateUnsubscribedAPIsList(list, subscribedIds) {
        const listLocal = list.filter((api) => !(api.throttlingPolicies.length === 1
             && api.throttlingPolicies[0].includes(CONSTANTS.DEFAULT_SUBSCRIPTIONLESS_PLAN)));
        for (let i = 0; i < listLocal.length; i++) {
            const policyList = listLocal[i].throttlingPolicies
                .filter((policy) => !policy.includes(CONSTANTS.DEFAULT_SUBSCRIPTIONLESS_PLAN));
            listLocal[i].throttlingPolicies = policyList;
            if (!((!subscribedIds.has(listLocal[i].id) && !listLocal[i].advertiseInfo.advertised)
                && listLocal[i].isSubscriptionAvailable)) {
                listLocal[i].throttlingPolicies = null;
            }
        }
        return listLocal;
        // return unsubscribedAPIList;
    }

    /**
     * @returns {JSX} render api card view
     * @memberof APICardView
     */
    render() {
        const { apisNotFound } = this.props;
        const { loading, data } = this.state;
        const { page, count, rowsPerPage } = this;

        if (apisNotFound) {
            return <ResourceNotFound />;
        }

        const {
            handleSubscribe, applicationId, intl,
        } = this.props;
        const columns = [
            {
                name: 'id',
                label: intl.formatMessage({
                    id: 'Apis.Listing.APIList.id',
                    defaultMessage: 'Id',
                }),
                options: {
                    display: 'excluded',
                },
            },
            {
                name: 'isSubscriptionAvailable',
                label: intl.formatMessage({
                    id: 'Apis.Listing.APIList.isSubscriptionAvailable',
                    defaultMessage: 'Is Subscription Available',
                }),
                options: {
                    display: 'excluded',
                },
            },
            {
                name: 'name',
                label: intl.formatMessage({
                    id: 'Apis.Listing.APIList.name',
                    defaultMessage: 'Name',
                }),
            },
            {
                name: 'version',
                label: intl.formatMessage({
                    id: 'Apis.Listing.APIList.version',
                    defaultMessage: 'Version',
                }),
            },
            {
                name: 'throttlingPolicies',
                label: intl.formatMessage({
                    id: 'Apis.Listing.APIList.subscription.status',
                    defaultMessage: 'Subscription Status',
                }),
                options: {
                    customBodyRender: (value, tableMeta) => {
                        if (tableMeta.rowData) {
                            const apiId = tableMeta.rowData[0];
                            const isSubscriptionAvailable = tableMeta.rowData[1];
                            const policies = value;
                            if (!isSubscriptionAvailable) {
                                return (intl.formatMessage({
                                    id: 'Apis.Listing.APICardView.not.allowed',
                                    defaultMessage: 'Not Allowed',
                                }));
                            }
                            if (!policies) {
                                return (intl.formatMessage({
                                    id: 'Apis.Listing.APICardView.already.subscribed',
                                    defaultMessage: 'Subscribed',
                                }));
                            }
                            return (
                                <SubscriptionPolicySelect
                                    key={apiId}
                                    policies={policies}
                                    apiId={apiId}
                                    handleSubscribe={(app, api, policy) => handleSubscribe(app, api, policy)}
                                    applicationId={applicationId}
                                />
                            );
                        }
                        return <span />;
                    },
                },
            },
        ];
        const options = {
            search: false,
            title: false,
            filter: false,
            print: false,
            download: false,
            viewColumns: false,
            customToolbar: false,
            responsive: 'stacked',
            serverSide: true,
            count,
            page,
            onTableChange: (action, tableState) => {
                switch (action) {
                    case 'changePage':
                        this.changePage(tableState.page);
                        break;
                    default:
                        break;
                }
            },
            selectableRows: 'none',
            rowsPerPage,
            onChangeRowsPerPage: (numberOfRows) => {
                const { page: pageInner, count: countInner } = this;
                if (pageInner * numberOfRows >= countInner) {
                    this.page = 0;
                }
                this.rowsPerPage = numberOfRows;
                this.page = 0;
                this.resetAPICache();
                this.setState({ loading: true });
                this.getData();
            },
            textLabels: {
                pagination: {
                    rowsPerPage: intl.formatMessage({
                        id: 'Apis.Listing.APICardView.rows.per.page',
                        defaultMessage: 'Rows per page',
                    }),
                },
            },
        };
        if (loading) {
            return <Loading />;
        }
        if (count === 0 || !data) {
            return <NoApi />;
        }
        return (
            <Root id='subscribe-to-api-table'>
                <MUIDataTable
                    title=''
                    data={data}
                    columns={columns}
                    options={options}
                />
            </Root>
        );
    }
}

APICardView.propTypes = {
    intl: PropTypes.shape({
        formatMessage: PropTypes.func,
    }).isRequired,
};
export default injectIntl((APICardView));
