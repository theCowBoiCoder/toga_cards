<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;

class Inventory extends RecordsPage
{
    protected static ?int $navigationSort = 10;

    protected function sourceRows(): array
    {
        return $this->client()->get('/api/inventory')['cards'];
    }

    protected function columns(): array
    {
        return [TextColumn::make('number')->label('#')->sortable(), TextColumn::make('player')->sortable(), TextColumn::make('club')->sortable(), TextColumn::make('variant'), TextColumn::make('condition'), TextColumn::make('stock')->numeric()->sortable(), TextColumn::make('stock_cost')->label('Stock cost')->money('GBP', divideBy: 100)];
    }

    protected function getHeaderActions(): array
    {
        return [$this->adminAction('addCard')->label('Add card')->schema([
            TextInput::make('player')->required()->maxLength(150), TextInput::make('club')->required()->maxLength(150), TextInput::make('number')->required()->maxLength(150),
            TextInput::make('season')->default('2026/27')->required(), TextInput::make('collection')->default('Topps Flagship Premier League')->required(), TextInput::make('variant')->default('Base')->required(),
            Select::make('condition')->options(array_combine(['Near mint', 'Excellent', 'Very good', 'Good', 'Poor'], ['Near mint', 'Excellent', 'Very good', 'Good', 'Poor']))->required(),
            TextInput::make('quantity')->label('Copies received')->integer()->minValue(1)->required(), $this->moneyInput('unitCost', 'Cost per card'), DatePicker::make('date')->default(today())->required(),
        ])->action(fn (array $data) => $this->perform('/api/inventory', [...$data, 'action' => 'card', 'unitCost' => $this->pence($data['unitCost'])], 'Card added')),
            $this->adminAction('export')->label('Export inventory')->url(route('admin.export', ['kind' => 'inventory']))];
    }

    protected function rowActions(): array
    {
        return [
            $this->adminAction('receive')->label('Receive stock')->schema([TextInput::make('quantity')->integer()->minValue(1)->required(), $this->moneyInput('unitCost', 'Cost per card'), DatePicker::make('date')->default(today())->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'stock', 'cardId' => $record['id'], 'unitCost' => $this->pence($data['unitCost'])], 'Receipt recorded')),
            $this->adminAction('count')->label('Set counted stock')->fillForm(fn (array $record): array => ['quantity' => $record['stock'], 'expectedStock' => $record['stock'], 'unitCost' => 0, 'date' => today()->toDateString()])
                ->schema([TextInput::make('quantity')->label('Physical copies counted')->integer()->minValue(0)->required(), Hidden::make('expectedStock'), $this->moneyInput('unitCost', 'Cost per additional card'), DatePicker::make('date')->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'adjust', 'cardId' => $record['id'], 'unitCost' => $this->pence($data['unitCost'])], 'Count updated')),
            $this->adminAction('sale')->label('Record offline sale')->schema([TextInput::make('quantity')->integer()->minValue(1)->required(), $this->moneyInput('unitPrice', 'Sale price per card'), $this->moneyInput('fees', 'Total fees and postage cost'), Select::make('platform')->options(['In person' => 'In person', 'Other' => 'Other'])->required(), DatePicker::make('date')->default(today())->required()])
                ->action(fn (array $data, array $record) => $this->perform('/api/inventory', [...$data, 'action' => 'sale', 'cardId' => $record['id'], 'unitPrice' => $this->pence($data['unitPrice']), 'fees' => $this->pence($data['fees'])], 'Sale recorded')),
        ];
    }
}
