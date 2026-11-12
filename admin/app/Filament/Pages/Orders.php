<?php

namespace App\Filament\Pages;

use Filament\Forms\Components\Checkbox;
use Filament\Forms\Components\Hidden;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Tables\Columns\TextColumn;
use Illuminate\Contracts\View\View;
use Illuminate\Support\Str;

class Orders extends RecordsPage
{
    protected static ?int $navigationSort = 30;

    protected function sourceRows(): array
    {
        return collect($this->client()->get('/api/admin/shop')['orders'])->map(fn (array $order): array => [...$order, 'return_status' => $order['returnRequest']['status'] ?? '', 'refunded' => $order['refunded'] ?? 0])->all();
    }

    protected function columns(): array
    {
        return [TextColumn::make('id')->label('Reference')->limit(12)->copyable(), TextColumn::make('created')->dateTime()->sortable(), TextColumn::make('email')->placeholder('Awaiting payment'), TextColumn::make('status')->badge(), TextColumn::make('total')->money('GBP', divideBy: 100), TextColumn::make('refunded')->money('GBP', divideBy: 100), TextColumn::make('return_status')->label('Return')->badge()->placeholder('No request'), TextColumn::make('dispatched_at')->dateTime()->placeholder('Not dispatched'), TextColumn::make('tracking_reference')->label('Postage / tracking')];
    }

    protected function rowActions(): array
    {
        return [
            $this->adminAction('details')->modalContent(fn (array $record): View => view('admin.order', ['order' => $record]))->modalSubmitAction(false)->modalCancelActionLabel('Close'),
            $this->adminAction('checkPayment')->label('Check Stripe')->visible(fn (array $record): bool => $record['status'] === 'pending')->action(fn (array $record) => $this->perform('/api/admin/reconcile', ['orderId' => $record['id']], 'Payment status checked')),
            $this->adminAction('dispatch')->label('Mark dispatched')->visible(fn (array $record): bool => $record['status'] === 'paid' && ! $record['dispatched_at'] && $record['refunded'] < $record['total'])
                ->schema([TextInput::make('tracking')->label('Tracking or postage reference')->required()->maxLength(150), TextInput::make('carrier')->label('Carrier')->maxLength(100), TextInput::make('trackingUrl')->label('HTTPS tracking link')->url()->startsWith('https://')->maxLength(2000)])
                ->action(fn (array $data, array $record) => $this->perform('/api/admin/dispatch', ['orderId' => $record['id'], ...$data], 'Dispatch recorded')),
            $this->adminAction('refund')->label('Issue refund')->visible(fn (array $record): bool => $record['status'] === 'paid' && $record['refunded'] < $record['total'])
                ->modalDescription('This submits a real refund to Stripe. Pending or unknown refunds must be checked before another request. Refunding never restores stock.')
                ->schema([Hidden::make('requestId')->default(fn (): string => (string) Str::uuid())->required(), $this->moneyInput('amount', 'Refund amount')->minValue(0.01)->maxValue(fn (array $record): float => ($record['total'] - $record['refunded']) / 100), Textarea::make('reason')->required()->maxLength(500), Checkbox::make('confirmed')->label('I have checked the order and approve this refund.')->accepted()])
                ->action(fn (array $data, array $record) => $this->perform('/api/admin/refund', ['orderId' => $record['id'], 'requestId' => $data['requestId'], 'amount' => $this->pence($data['amount']), 'reason' => $data['reason']], 'Refund submitted; check its recorded status')),
            $this->adminAction('retryRefund')->label('Retry unconfirmed refund')->visible(fn (array $record): bool => collect($record['refunds'] ?? [])->contains('status', 'requested'))->requiresConfirmation()
                ->modalDescription('Retries the recorded request with the same Stripe idempotency key; it does not create a new refund request.')
                ->action(function (array $record): void {
                    $refund = collect($record['refunds'])->firstWhere('status', 'requested');
                    $this->perform('/api/admin/refund', ['orderId' => $record['id'], 'requestId' => $refund['id'], 'amount' => $refund['amount'], 'reason' => $refund['reason']], 'Refund retry checked; review recorded status');
                }),
            $this->adminAction('checkRefunds')->label('Check refunds')->visible(fn (array $record): bool => $record['status'] === 'paid')
                ->action(fn (array $record) => $this->perform('/api/admin/refund', ['action' => 'reconcile', 'orderId' => $record['id']], 'Stripe refund status checked')),
            $this->adminAction('openReturn')->label('Open return')->visible(fn (array $record): bool => $record['status'] === 'paid' && ! $record['return_status'])
                ->schema([Textarea::make('reason')->label('Customer request / reason')->required()->maxLength(2000)])
                ->action(fn (array $data, array $record) => $this->perform('/api/admin/returns', ['action' => 'open', 'orderId' => $record['id'], ...$data], 'Return request recorded')),
            $this->adminAction('reviewReturn')->label('Review return')->visible(fn (array $record): bool => filled($record['return_status']) && $record['return_status'] !== 'closed')
                ->schema([Select::make('status')->options(fn (array $record): array => match ($record['return_status']) {
                    'requested' => ['approved' => 'Approve return', 'declined' => 'Decline request'], 'approved' => ['received' => 'Return received', 'closed' => 'Close request'], 'received' => ['closed' => 'Close request'], 'declined' => ['approved' => 'Approve return'], default => []
                })->required(), Textarea::make('response')->label('Response visible to the customer')->required()->maxLength(2000)])
                ->action(fn (array $data, array $record) => $this->perform('/api/admin/returns', ['orderId' => $record['id'], ...$data], 'Return status updated')),
            $this->adminAction('restockReturn')->label('Restock returned cards')->visible(fn (array $record): bool => in_array($record['return_status'], ['received', 'closed'], true))
                ->modalDescription('Only restock received cards after inspecting their condition. Copies return to physical stock and must be allocated separately before sale.')
                ->schema([Select::make('cardId')->options(fn (array $record): array => collect($record['items'])->mapWithKeys(fn (array $item): array => [$item['card_id'] => $item['player'].' #'.$item['number'].' · '.$item['variant'].' ('.($item['returned'] ?? 0).' already restocked)'])->all())->required(), TextInput::make('quantity')->label('Total returned copies received and inspected')->integer()->minValue(1)->required(), Checkbox::make('inspected')->label('I have received and inspected these cards; they match the recorded condition.')->accepted()])
                ->action(fn (array $data, array $record) => $this->perform('/api/admin/returns', ['action' => 'restock', 'orderId' => $record['id'], 'cardId' => (int) $data['cardId'], 'quantity' => $data['quantity']], 'Returned stock received')),
        ];
    }
}
