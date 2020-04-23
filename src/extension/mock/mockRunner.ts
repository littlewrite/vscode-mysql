import { existsSync } from 'fs';
import * as Mock from 'mockjs';
import * as vscode from "vscode";
import { MessageType } from "../../common/Constants";
import { ConnectionManager } from "../../database/ConnectionManager";
import { DatabaseCache } from "../../database/DatabaseCache";
import { QueryUnit } from "../../database/QueryUnit";
import { ColumnNode } from "../../model/table/columnNode";
import { TableNode } from '../../model/table/tableNode';
import { QueryPage } from "../../view/result/query";
import { MessageResponse } from "../../view/result/queryResponse";
import { FileManager, FileModel } from '../FileManager';
import { MockModel } from './mockModel';
import format = require('date-format');

export class MockRunner {

    private readonly MOCK_INDEX = "$mockIndex";

    public async create(tableNode: TableNode) {
        const mockModel: MockModel = {
            host: tableNode.host, port: tableNode.port, user: tableNode.user, database: tableNode.database, table: tableNode.table,
            mockStartIndex: tableNode.primaryKey ? tableNode.primaryKey : 1
            , mockCount: 50, mock: {}
        }
        const columnList = (await tableNode.getChildren()) as ColumnNode[]
        for (const columnNode of columnList) {
            mockModel.mock[columnNode.column.name] = {
                type: columnNode.column.simpleType,
                value: this.getValueByType(columnNode.column)
            }
        }

        const mockPath = `mock/${tableNode.table}/mock.json`;
        const mockFullPath = `${FileManager.storagePath}/${mockPath}`;
        if (!existsSync(mockFullPath)) {
            await FileManager.record(mockPath, JSON.stringify(mockModel, null, 4), FileModel.WRITE);
        }
        await vscode.window.showTextDocument(
            await vscode.workspace.openTextDocument(mockFullPath)
        );
    }

    public async runMock() {

        const content = vscode.window.activeTextEditor.document.getText()

        const mockModel = JSON.parse(content) as MockModel;
        const databaseid = `${mockModel.host}_${mockModel.port}_${mockModel.user}_${mockModel.database}`;
        const tableList = DatabaseCache.getTableListOfDatabase(databaseid) as TableNode[]
        if (!tableList) {
            vscode.window.showErrorMessage(`Database ${mockModel.database} not found!`)
            return;
        }
        let tableNode: TableNode;
        for (const table of tableList) {
            if (table.table == mockModel.table) {
                tableNode = table
            }
        }
        if (!tableNode) {
            vscode.window.showErrorMessage(`Table ${mockModel.table} not found!`)
            return;
        }

        const insertSqlTemplate = (await tableNode.insertSqlTemplate(false)).replace("\n", " ");
        const sqlList = [];
        const mockData = mockModel.mock;
        const { mockStartIndex, mockCount } = mockModel
        let startIndex = 1;
        if (mockStartIndex != null) {
            if (!isNaN(Number(mockStartIndex))) {
                startIndex = mockStartIndex as number
            } else if (mockStartIndex.toString().toLowerCase() == "auto") {
                startIndex = (await tableNode.getMaxPrimary()) + 1;
            }

            for (let i = startIndex; i < (startIndex + mockCount); i++) {
                let tempInsertSql = insertSqlTemplate;
                for (const column in mockData) {
                    let value = mockData[column].value;
                    if (value == this.MOCK_INDEX) { value = i; }
                    tempInsertSql = tempInsertSql.replace(new RegExp("\\$+" + column, 'i'), this.wrapQuote(mockData[column].type, Mock.mock(value)));
                }
                sqlList.push(tempInsertSql)
            }

            const connection = await ConnectionManager.getConnection({ ...mockModel })
            const success = await QueryUnit.runBatch(connection, sqlList)
            QueryPage.send({ type: MessageType.MESSAGE, res: { message: `Generate mock data for ${tableNode.table} ${success ? 'success' : 'fail'}!`, success } as MessageResponse });

        }
    }

    private wrapQuote(type: string, value: any): any {
        type = type.toLowerCase()
        switch (type) {
            case "varchar": case "char": case "date": case "time": case "timestamp": case "datetime":
                return `'${value}'`
        }
        return value;
    }



    // refrence : http://mockjs.com/examples.html
    private getValueByType(column: any): string {
        const type = column.simpleType.toLowerCase()
        const match = column.type.match(/.+?\((\d+)\)/);
        let length = 1024
        if (match) {
            length = 1 << (match[1] - 1)
        }
        if (column.key == "PRI") {
            return this.MOCK_INDEX;
        }
        // console.log(type)
        switch (type) {
            case "bit":
                return "@integer(0," + length + ")";
            case "char":
                return "@character('lower')";
            case "text":
                return "@sentence()"
            case "varchar":
                return "@string('lower',5)"
            // return "@cword(5)"
            case "tinyint":
                return "@integer(0," + length + ")";
            case "smallint":
                return "@integer(0," + length + ")";
            case "double": case "float":
                return "@float(0,100,2,2)"
            case "date":
                return "@date()"
            case "time":
                return "@time()"
            case "timestamp": case "datetime":
                return "@datetime()"
        }
        return "@integer(1," + length + ")";
    }

}