<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;
use Illuminate\Contracts\View\View;

class Orders extends RecordsPage
{
    protected static ?int $navigationSort = 30;

    protected function sourceRows(): array
    {
        return $this->client()->get('/api/admin/shop')['orders'];
    }

    protected function columns(): array
    {
        return [TextColumn::make('id')->label('Reference')->limit(12)->copyable(), TextColumn::make('created')->dateTime()->sortable(), TextColumn::make('email')->placeholder('Awaiting payment'), TextColumn::make('status')->badge(), TextColumn::make('total')->money('GBP', divideBy: 100), TextColumn::make('dispatched_at')->dateTime()->placeholder('Not dispatched'), TextColumn::make('tracking_reference')->label('Postage / tracking')];
    }

    protected function rowActions(): array
    {
        return [$this->adminAction('details')->modalContent(fn (array $record): View => view('admin.order', ['order' => $record]))->modalSubmitAction(false)->modalCancelActionLabel('Close'),
            $this->adminAction('checkPayment')->label('Check Stripe')->visible(fn (array $record): bool => $record['status'] === 'pending')->action(fn (array $record) => $this->perform('/api/admin/reconcile', ['orderId' => $record['id']], 'Payment status checked')),
            $this->adminAction('dispatch')->label('Mark dispatched')->visible(fn (array $record): bool => $record['status'] === 'paid' && ! $record['dispatched_at'])->schema([TextInput::make('tracking')->label('Tracking or postage reference')->required()->maxLength(150)])->action(fn (array $data, array $record) => $this->perform('/api/admin/dispatch', ['orderId' => $record['id'], 'tracking' => $data['tracking']], 'Dispatch recorded'))];
    }
}
