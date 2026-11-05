<?php

namespace App\Filament\Widgets;

use App\Services\InventoryClient;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

class StockStats extends StatsOverviewWidget
{
    protected function getStats(): array
    {
        $snapshot = app(InventoryClient::class)->get('/api/inventory');
        $cards = collect($snapshot['cards']);
        $sales = collect($snapshot['sales']);

        return [Stat::make('Physical copies', number_format($cards->sum('stock'))), Stat::make('Cards in stock', number_format($cards->where('stock', '>', 0)->count())), Stat::make('Recorded item revenue', '£'.number_format($sales->sum('gross') / 100, 2))->description('Fees and postage may still need confirmation.')];
    }
}
