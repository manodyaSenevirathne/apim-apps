/*
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
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

import Utils from "@support/utils";

describe("devportal-000-06 : Download Postman collection from API Console", () => {
    const { publisher, developer, password } = Utils.getUserInfo();
    const apiVersion = "1.0.0";
    let apiName;
    let apiContext;
    let testApiId;

    it.only("Download Postman collection", {
        retries: { runMode: 3, openMode: 0 },
    }, () => {
        apiName = Utils.generateName();
        apiContext = apiName;

        cy.loginToPublisher(publisher, password);

        Utils.addAPIWithEndpoints({
            name: apiName,
            version: apiVersion,
            context: apiContext,
            endpoint: 'https://petstore.swagger.io/v2/swagger.json',
        }).then((apiId) => {
            testApiId = apiId;
            Utils.publishAPI(apiId).then(() => {
                cy.logoutFromPublisher();
                cy.loginToDevportal(developer, password);

                // Intercept the swagger fetch so we know when ApiConsole has fully rendered
                cy.intercept('GET', `**/apis/${apiId}/swagger`).as('swagger');

                cy.visit(`/devportal/apis/${apiId}/api-console?tenant=carbon.super`);

                // Wait for swagger to load — ApiConsole shows <Progress /> until this resolves
                cy.wait('@swagger', { timeout: Cypress.config().largeTimeout });

                // Click the Postman collection download button
                cy.contains('button', 'Postman collection', { timeout: 30000 }).click();

                // Verify the downloaded file is valid JSON with Postman collection structure
                const downloadsFolder = Cypress.config('downloadsFolder');
                cy.readFile(`${downloadsFolder}/postman collection`, { timeout: 15000 }).then((content) => {
                    const collection = typeof content === 'string' ? JSON.parse(content) : content;
                    expect(collection).to.have.property('info');
                    expect(collection.info).to.have.property('name');
                    expect(collection).to.have.property('item');
                });
            });
        });
    });

    after(() => {
        Utils.deleteAPI(testApiId);
    });
});
